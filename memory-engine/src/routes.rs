use axum::{http::StatusCode, routing::{get, post}, Json, Router};
use serde::{Deserialize, Serialize};
use crate::embedding::embed;
use crate::retrieval::cosine;
use crate::storage::{load, store, list_all, MemoryEntry};

// Request / Response types 

#[derive(Deserialize)]
pub struct StoreReq {
    project: String,
    source: String,
    context: String,
    id: Option<String>,
}

#[derive(Deserialize)]
pub struct RetrieveReq {
    project: String,
    prompt: String,
}

#[derive(Deserialize)]
pub struct ListReq {
    project: String,
}

#[derive(Serialize, Deserialize)]
pub struct HealthResponse {
    pub status: String,
}

// Router
pub fn routes() -> Router {
    Router::new()
        .route("/store", post(store_handler))
        .route("/retrieve", post(retrieve_handler))
        .route("/list", post(list_handler))
        .route("/health", get(health))
}

// Handlers 
async fn store_handler(
    Json(req): Json<StoreReq>,
) -> Result<Json<&'static str>, (StatusCode, String)> {
    if req.project.trim().is_empty() {
        return Err((StatusCode::BAD_REQUEST, "project must not be empty".into()));
    }
    if req.context.trim().is_empty() {
        return Err((StatusCode::BAD_REQUEST, "context must not be empty".into()));
    }
    let emb = embed(&req.context);
    store(&req.project, &req.source, &req.context, &emb, req.id.as_deref())
        .map_err(|e| {
            tracing::error!("store failed: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, format!("storage error: {}", e))
        })?;
    tracing::info!(
        project = %req.project,
        source = %req.source,
        id = ?req.id,
        len = req.context.len(),
        "stored memory"
    );
    Ok(Json("ok"))
}

async fn retrieve_handler(
    Json(req): Json<RetrieveReq>,
) -> Result<Json<Vec<String>>, (StatusCode, String)> {
    if req.project.trim().is_empty() {
        return Err((StatusCode::BAD_REQUEST, "project must not be empty".into()));
    }
    if req.prompt.trim().is_empty() {
        return Err((StatusCode::BAD_REQUEST, "prompt must not be empty".into()));
    }

    let target = embed(&req.prompt);
    let data = load(&req.project);

    let mut scored = vec![];

    for (content, emb) in data {
        let score = cosine(&target, &emb);
        scored.push((score, content));
    }

    scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));

    let result: Vec<String> = scored.into_iter().take(5).map(|x| x.1).collect();

    tracing::info!(
        project = %req.project,
        prompt_len = req.prompt.len(),
        results = result.len(),
        "retrieved memories"
    );

    Ok(Json(result))
}

/// Simple health-check endpoint.
async fn health() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok".into(),
    })
}

async fn list_handler(
    Json(req): Json<ListReq>,
) -> Result<Json<Vec<MemoryEntry>>, (StatusCode, String)> {
    if req.project.trim().is_empty() {
        return Err((StatusCode::BAD_REQUEST, "project must not be empty".into()));
    }

    let entries = list_all(&req.project);

    tracing::info!(
        project = %req.project,
        count = entries.len(),
        "listed memories"
    );

    Ok(Json(entries))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use tower::ServiceExt;
    use http_body_util::BodyExt;
    use tempfile::TempDir;
    fn json_request(uri: &str, body: serde_json::Value) -> Request<Body> {
        Request::builder()
            .uri(uri)
            .method("POST")
            .header("Content-Type", "application/json")
            .body(Body::from(body.to_string()))
            .unwrap()
    }
    #[tokio::test]
    async fn health_returns_ok() {
        let app = routes();
        let req = Request::builder()
            .uri("/health")
            .method("GET")
            .body(Body::empty())
            .unwrap();

        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);

        let body = resp.into_body().collect().await.unwrap().to_bytes();
        let json: HealthResponse = serde_json::from_slice(&body).unwrap();
        assert_eq!(json.status, "ok");
    }

    #[tokio::test]
    async fn store_returns_ok() {
        let dir = TempDir::new().unwrap();
        let project = dir.path().to_str().unwrap();

        let app = routes();
        let req = json_request("/store", serde_json::json!({
            "project": project,
            "source": "test.rs",
            "context": "fn hello() {}"
        }));

        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);

        let body = resp.into_body().collect().await.unwrap().to_bytes();
        let text: String = serde_json::from_slice(&body).unwrap();
        assert_eq!(text, "ok");

        // Verify file was created
        let mem_dir = dir.path().join(".copilot-memory");
        assert!(mem_dir.exists());
        let files: Vec<_> = std::fs::read_dir(&mem_dir).unwrap().collect();
        assert_eq!(files.len(), 1);
    }

    #[tokio::test]
    async fn store_with_id_upserts() {
        let dir = TempDir::new().unwrap();
        let project = dir.path().to_str().unwrap();

        let app = routes();

        // First store
        let req = json_request("/store", serde_json::json!({
            "project": project,
            "source": "chat",
            "context": "first",
            "id": "session-abc"
        }));
        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);

        // Second store with same id
        let req = json_request("/store", serde_json::json!({
            "project": project,
            "source": "chat",
            "context": "updated",
            "id": "session-abc"
        }));
        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);

        // Only 1 file
        let mem_dir = dir.path().join(".copilot-memory");
        let files: Vec<_> = std::fs::read_dir(&mem_dir).unwrap().collect();
        assert_eq!(files.len(), 1);
    }

    #[tokio::test]
    async fn store_then_retrieve() {
        let dir = TempDir::new().unwrap();
        let project = dir.path().to_str().unwrap();

        let app = routes();

        // Store
        let req = json_request("/store", serde_json::json!({
            "project": project,
            "source": "auth.rs",
            "context": "fn authenticate(user: &str, pass: &str) -> bool { true }"
        }));
        app.clone().oneshot(req).await.unwrap();

        // Retrieve
        let req = json_request("/retrieve", serde_json::json!({
            "project": project,
            "prompt": "authentication"
        }));
        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);

        let body = resp.into_body().collect().await.unwrap().to_bytes();
        let results: Vec<String> = serde_json::from_slice(&body).unwrap();
        assert_eq!(results.len(), 1);
        assert!(results[0].contains("authenticate"));
    }

    #[tokio::test]
    async fn retrieve_empty_project() {
        let dir = TempDir::new().unwrap();
        let project = dir.path().to_str().unwrap();

        let app = routes();
        let req = json_request("/retrieve", serde_json::json!({
            "project": project,
            "prompt": "anything"
        }));
        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);

        let body = resp.into_body().collect().await.unwrap().to_bytes();
        let results: Vec<String> = serde_json::from_slice(&body).unwrap();
        assert!(results.is_empty());
    }

    #[tokio::test]
    async fn retrieve_returns_top_5() {
        let dir = TempDir::new().unwrap();
        let project = dir.path().to_str().unwrap();

        let app = routes();
        // Store 7 items
        for i in 0..7 {
            let req = json_request("/store", serde_json::json!({
                "project": project,
                "source": format!("file{i}.rs"),
                "context": format!("content number {i} about testing")
            }));
            app.clone().oneshot(req).await.unwrap();
        }

        // Retrieve
        let req = json_request("/retrieve", serde_json::json!({
            "project": project,
            "prompt": "testing"
        }));
        let resp = app.oneshot(req).await.unwrap();

        let body = resp.into_body().collect().await.unwrap().to_bytes();
        let results: Vec<String> = serde_json::from_slice(&body).unwrap();
        assert!(results.len() <= 5, "Should return at most 5 results, got {}", results.len());
    }

    #[tokio::test]
    async fn store_missing_field_returns_error() {
        let app = routes();
        // Missing "context" field
        let req = json_request("/store", serde_json::json!({
            "project": "test",
            "source": "test.rs"
        }));
        let resp = app.oneshot(req).await.unwrap();
        // Axum returns 422 for deserialization failures
        assert_eq!(resp.status(), StatusCode::UNPROCESSABLE_ENTITY);
    }

    #[tokio::test]
    async fn store_empty_project_returns_400() {
        let app = routes();
        let req = json_request("/store", serde_json::json!({
            "project": "  ",
            "source": "test.rs",
            "context": "some code"
        }));
        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn store_empty_context_returns_400() {
        let app = routes();
        let req = json_request("/store", serde_json::json!({
            "project": "/tmp/test",
            "source": "test.rs",
            "context": ""
        }));
        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn retrieve_empty_project_returns_400() {
        let app = routes();
        let req = json_request("/retrieve", serde_json::json!({
            "project": "",
            "prompt": "something"
        }));
        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn retrieve_empty_prompt_returns_400() {
        let app = routes();
        let req = json_request("/retrieve", serde_json::json!({
            "project": "/tmp/test",
            "prompt": "   "
        }));
        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn list_returns_entries() {
        let dir = TempDir::new().unwrap();
        let project = dir.path().to_str().unwrap();
        let app = routes();

        // Store two items
        let req = json_request("/store", serde_json::json!({
            "project": project,
            "source": "chat",
            "context": "conversation 1"
        }));
        app.clone().oneshot(req).await.unwrap();

        let req = json_request("/store", serde_json::json!({
            "project": project,
            "source": "file",
            "context": "code content"
        }));
        app.clone().oneshot(req).await.unwrap();

        // List
        let req = json_request("/list", serde_json::json!({
            "project": project
        }));
        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);

        let body = resp.into_body().collect().await.unwrap().to_bytes();
        let entries: Vec<MemoryEntry> = serde_json::from_slice(&body).unwrap();
        assert_eq!(entries.len(), 2);
    }

    #[tokio::test]
    async fn list_empty_project_returns_400() {
        let app = routes();
        let req = json_request("/list", serde_json::json!({
            "project": ""
        }));
        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn list_no_memories_returns_empty() {
        let dir = TempDir::new().unwrap();
        let project = dir.path().to_str().unwrap();
        let app = routes();

        let req = json_request("/list", serde_json::json!({
            "project": project
        }));
        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);

        let body = resp.into_body().collect().await.unwrap().to_bytes();
        let entries: Vec<MemoryEntry> = serde_json::from_slice(&body).unwrap();
        assert!(entries.is_empty());
    }

    #[tokio::test]
    async fn store_with_id_then_list_shows_correct_id() {
        let dir = TempDir::new().unwrap();
        let project = dir.path().to_str().unwrap();
        let app = routes();

        let req = json_request("/store", serde_json::json!({
            "project": project,
            "source": "chat-saved",
            "context": "my saved conversation",
            "id": "save-abc123"
        }));
        app.clone().oneshot(req).await.unwrap();

        let req = json_request("/list", serde_json::json!({
            "project": project
        }));
        let resp = app.oneshot(req).await.unwrap();

        let body = resp.into_body().collect().await.unwrap().to_bytes();
        let entries: Vec<MemoryEntry> = serde_json::from_slice(&body).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].id, "save-abc123");
        assert_eq!(entries[0].source, "chat-saved");
    }

    #[tokio::test]
    async fn store_upsert_then_list_shows_latest() {
        let dir = TempDir::new().unwrap();
        let project = dir.path().to_str().unwrap();
        let app = routes();

        // Store then update same id
        let req = json_request("/store", serde_json::json!({
            "project": project,
            "source": "chat",
            "context": "old content",
            "id": "session-x"
        }));
        app.clone().oneshot(req).await.unwrap();

        let req = json_request("/store", serde_json::json!({
            "project": project,
            "source": "chat",
            "context": "new content",
            "id": "session-x"
        }));
        app.clone().oneshot(req).await.unwrap();

        let req = json_request("/list", serde_json::json!({
            "project": project
        }));
        let resp = app.oneshot(req).await.unwrap();

        let body = resp.into_body().collect().await.unwrap().to_bytes();
        let entries: Vec<MemoryEntry> = serde_json::from_slice(&body).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].content, "new content");
    }
}
