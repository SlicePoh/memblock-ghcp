/// Split `text` into chunks of at most `size` bytes.
/// Useful for breaking large documents before embedding + storage.
pub fn chunk_text(text: &str, size: usize) -> Vec<String> {
    let mut chunks = vec![];
    let mut start = 0;

    while start < text.len() {
        let end = (start + size).min(text.len());
        chunks.push(text[start..end].to_string());
        start += size;
    }

    chunks
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chunk_exact_multiple() {
        let chunks = chunk_text("abcdef", 3);
        assert_eq!(chunks, vec!["abc", "def"]);
    }

    #[test]
    fn chunk_with_remainder() {
        let chunks = chunk_text("abcde", 3);
        assert_eq!(chunks, vec!["abc", "de"]);
    }

    #[test]
    fn chunk_empty() {
        let chunks = chunk_text("", 5);
        assert!(chunks.is_empty());
    }
}
