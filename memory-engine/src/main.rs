mod chunking;
mod embedding;
mod retrieval;
mod routes;
mod storage;

use tower_http::cors::{Any, CorsLayer};
use tower_http::limit::RequestBodyLimitLayer;

#[tokio::main]
async fn main() {
    // Initialise structured logging
    tracing_subscriber::fmt()
        .with_target(false)
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "memory_engine=info".into()),
        )
        .init();

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    // 2 MB request body limit
    let body_limit = RequestBodyLimitLayer::new(2 * 1024 * 1024);

    let app = routes::routes().layer(cors).layer(body_limit);

    let port = std::env::var("PORT").unwrap_or_else(|_| "3210".to_string());
    let addr = format!("0.0.0.0:{}", port);
    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .expect("failed to bind");

    tracing::info!("memory-engine listening on http://{}", addr);

    axum::serve(listener, app).await.unwrap();
}
