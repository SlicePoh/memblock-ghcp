use std::fs;
use std::path::PathBuf;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Serialize, Deserialize)]
struct Chunk {
    source: String,
    content: String,
    embedding: Vec<f32>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct MemoryEntry {
    pub id: String,
    pub source: String,
    pub preview: String,
    pub content: String,
}

/// Build the `.copilot-memory` directory inside the given project root.
fn memory_dir(project: &str) -> PathBuf {
    PathBuf::from(project).join(".copilot-memory")
}

pub fn store(
    project: &str,
    source: &str,
    content: &str,
    embedding: &Vec<f32>,
    id: Option<&str>,
) -> Result<(), String> {
    let base = memory_dir(project);
    fs::create_dir_all(&base).map_err(|e| format!("failed to create dir {:?}: {}", base, e))?;

    let filename = match id {
        Some(id) => id.to_string(),
        None => Uuid::new_v4().to_string(),
    };
    let file = base.join(format!("{}.mpk", filename));

    let chunk = Chunk {
        source: source.to_string(),
        content: content.to_string(),
        embedding: embedding.clone(),
    };

    let bytes = rmp_serde::to_vec(&chunk).map_err(|e| format!("serialize error: {}", e))?;
    fs::write(&file, bytes).map_err(|e| format!("write error {:?}: {}", file, e))?;
    Ok(())
}

pub fn load(project: &str) -> Vec<(String, Vec<f32>)> {
    let base = memory_dir(project);
    let mut out = vec![];

    let entries = match fs::read_dir(&base) {
        Ok(e) => e,
        Err(_) => {
            tracing::debug!("no memory dir at {:?}, returning empty", base);
            return out;
        }
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("mpk") {
            continue;
        }
        match fs::read(&path) {
            Ok(bytes) => match rmp_serde::from_slice::<Chunk>(&bytes) {
                Ok(chunk) => out.push((chunk.content, chunk.embedding)),
                Err(e) => tracing::warn!("skipping corrupted {:?}: {}", path, e),
            },
            Err(e) => tracing::warn!("cannot read {:?}: {}", path, e),
        }
    }

    out
}

pub fn list_all(project: &str) -> Vec<MemoryEntry> {
    let base = memory_dir(project);
    let mut out = vec![];

    let entries = match fs::read_dir(&base) {
        Ok(e) => e,
        Err(_) => return out,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("mpk") {
            continue;
        }
        let id = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("unknown")
            .to_string();

        match fs::read(&path) {
            Ok(bytes) => match rmp_serde::from_slice::<Chunk>(&bytes) {
                Ok(chunk) => {
                    let preview = if chunk.content.len() > 120 {
                        format!("{}…", &chunk.content[..120])
                    } else {
                        chunk.content.clone()
                    };
                    out.push(MemoryEntry {
                        id,
                        source: chunk.source,
                        preview,
                        content: chunk.content,
                    });
                }
                Err(e) => tracing::warn!("skipping corrupted {:?}: {}", path, e),
            },
            Err(e) => tracing::warn!("cannot read {:?}: {}", path, e),
        }
    }

    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn test_embedding() -> Vec<f32> {
        vec![0.1, 0.2, 0.3, 0.4]
    }

    #[test]
    fn store_creates_file() {
        let dir = TempDir::new().unwrap();
        let project = dir.path().to_str().unwrap();
        store(project, "test.rs", "fn main() {}", &test_embedding(), None).unwrap();

        let mem_dir = dir.path().join(".copilot-memory");
        assert!(mem_dir.exists());
        let files: Vec<_> = fs::read_dir(&mem_dir).unwrap().collect();
        assert_eq!(files.len(), 1);
    }

    #[test]
    fn store_and_load_roundtrip() {
        let dir = TempDir::new().unwrap();
        let project = dir.path().to_str().unwrap();
        let emb = test_embedding();

        store(project, "src/main.rs", "hello world", &emb, None).unwrap();
        let loaded = load(project);

        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].0, "hello world");
        assert_eq!(loaded[0].1, emb);
    }

    #[test]
    fn store_multiple_chunks() {
        let dir = TempDir::new().unwrap();
        let project = dir.path().to_str().unwrap();

        store(project, "a.rs", "content a", &vec![1.0, 0.0], None).unwrap();
        store(project, "b.rs", "content b", &vec![0.0, 1.0], None).unwrap();
        store(project, "c.rs", "content c", &vec![0.5, 0.5], None).unwrap();

        let loaded = load(project);
        assert_eq!(loaded.len(), 3);

        let contents: Vec<&str> = loaded.iter().map(|(c, _)| c.as_str()).collect();
        assert!(contents.contains(&"content a"));
        assert!(contents.contains(&"content b"));
        assert!(contents.contains(&"content c"));
    }

    #[test]
    fn store_with_id_upserts() {
        let dir = TempDir::new().unwrap();
        let project = dir.path().to_str().unwrap();

        store(project, "chat", "first version", &vec![1.0], Some("session-1")).unwrap();
        store(project, "chat", "updated version", &vec![2.0], Some("session-1")).unwrap();

        let loaded = load(project);
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].0, "updated version");
        assert_eq!(loaded[0].1, vec![2.0]);
    }

    #[test]
    fn store_with_and_without_id() {
        let dir = TempDir::new().unwrap();
        let project = dir.path().to_str().unwrap();

        store(project, "chat", "session data", &vec![1.0], Some("my-session")).unwrap();
        store(project, "file", "file data", &vec![2.0], None).unwrap();
        store(project, "file", "file data 2", &vec![3.0], None).unwrap();

        let loaded = load(project);
        assert_eq!(loaded.len(), 3);
    }

    #[test]
    fn load_empty_project() {
        let dir = TempDir::new().unwrap();
        let project = dir.path().to_str().unwrap();
        let loaded = load(project);
        assert!(loaded.is_empty());
    }

    #[test]
    fn load_ignores_non_mpk_files() {
        let dir = TempDir::new().unwrap();
        let project = dir.path().to_str().unwrap();
        let mem_dir = dir.path().join(".copilot-memory");
        fs::create_dir_all(&mem_dir).unwrap();

        // Write a non-mpk file
        fs::write(mem_dir.join("notes.txt"), "not a memory").unwrap();
        // Write a valid mpk file
        store(project, "src", "real data", &vec![1.0, 2.0], None).unwrap();

        let loaded = load(project);
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].0, "real data");
    }

    #[test]
    fn load_skips_corrupted_files() {
        let dir = TempDir::new().unwrap();
        let project = dir.path().to_str().unwrap();
        let mem_dir = dir.path().join(".copilot-memory");
        fs::create_dir_all(&mem_dir).unwrap();

        // Write garbage as .mpk
        fs::write(mem_dir.join("bad.mpk"), b"not valid msgpack").unwrap();
        // Write a valid one
        store(project, "src", "good data", &vec![1.0], None).unwrap();

        let loaded = load(project);
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].0, "good data");
    }

    #[test]
    fn list_all_returns_entries() {
        let dir = TempDir::new().unwrap();
        let project = dir.path().to_str().unwrap();

        store(project, "chat", "hello from chat", &vec![1.0], Some("s1")).unwrap();
        store(project, "file", "code content", &vec![2.0], None).unwrap();

        let entries = list_all(project);
        assert_eq!(entries.len(), 2);

        let sources: Vec<&str> = entries.iter().map(|e| e.source.as_str()).collect();
        assert!(sources.contains(&"chat"));
        assert!(sources.contains(&"file"));
    }

    #[test]
    fn list_all_empty_project() {
        let dir = TempDir::new().unwrap();
        let project = dir.path().to_str().unwrap();
        let entries = list_all(project);
        assert!(entries.is_empty());
    }

    #[test]
    fn list_all_preserves_id() {
        let dir = TempDir::new().unwrap();
        let project = dir.path().to_str().unwrap();

        store(project, "chat", "session data", &vec![1.0], Some("my-session")).unwrap();
        let entries = list_all(project);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].id, "my-session");
    }

    #[test]
    fn list_all_preview_truncates_long_content() {
        let dir = TempDir::new().unwrap();
        let project = dir.path().to_str().unwrap();

        let long_text = "a".repeat(300);
        store(project, "src", &long_text, &vec![1.0], None).unwrap();

        let entries = list_all(project);
        assert_eq!(entries.len(), 1);
        assert!(entries[0].preview.len() < entries[0].content.len());
        assert!(entries[0].preview.ends_with('…'));
        assert_eq!(entries[0].content.len(), 300);
    }

    #[test]
    fn list_all_skips_corrupted_and_non_mpk() {
        let dir = TempDir::new().unwrap();
        let project = dir.path().to_str().unwrap();
        let mem_dir = dir.path().join(".copilot-memory");
        fs::create_dir_all(&mem_dir).unwrap();

        fs::write(mem_dir.join("bad.mpk"), b"garbage").unwrap();
        fs::write(mem_dir.join("notes.txt"), "not a memory").unwrap();
        store(project, "src", "good data", &vec![1.0], None).unwrap();

        let entries = list_all(project);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].content, "good data");
    }

    #[test]
    fn store_overwrites_content_on_upsert() {
        let dir = TempDir::new().unwrap();
        let project = dir.path().to_str().unwrap();

        store(project, "chat", "v1", &vec![1.0], Some("sess")).unwrap();
        store(project, "chat", "v2", &vec![2.0], Some("sess")).unwrap();
        store(project, "chat", "v3", &vec![3.0], Some("sess")).unwrap();

        let entries = list_all(project);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].content, "v3");
        assert_eq!(entries[0].source, "chat");
    }

    #[test]
    fn messagepack_is_smaller_than_json() {
        let dir = TempDir::new().unwrap();
        let project = dir.path().to_str().unwrap();
        let content = "fn main() { println!(\"hello world\"); }";
        let emb: Vec<f32> = (0..128).map(|i| i as f32 / 128.0).collect();

        store(project, "test.rs", content, &emb, None).unwrap();

        let mem_dir = dir.path().join(".copilot-memory");
        let mpk_file = fs::read_dir(&mem_dir).unwrap().next().unwrap().unwrap();
        let mpk_size = fs::metadata(mpk_file.path()).unwrap().len();

        // Equivalent JSON for comparison
        let json = serde_json::json!({
            "source": "test.rs",
            "content": content,
            "embedding": emb
        });
        let json_size = json.to_string().len() as u64;

        assert!(mpk_size < json_size, "MessagePack ({mpk_size}) should be smaller than JSON ({json_size})");
    }
}