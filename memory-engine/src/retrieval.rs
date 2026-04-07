/// Compute cosine similarity between two vectors.
/// Since our embeddings are L2-normalised, this is effectively the dot product.
pub fn cosine(a: &[f32], b: &[f32]) -> f32 {
    let mut dot = 0.0;
    for i in 0..a.len().min(b.len()) {
        dot += a[i] * b[i];
    }
    dot
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identical_normalised_vectors() {
        let v: Vec<f32> = vec![1.0, 0.0, 0.0];
        let sim = cosine(&v, &v);
        assert!((sim - 1.0).abs() < 1e-5);
    }

    #[test]
    fn orthogonal_vectors() {
        let a = vec![1.0, 0.0];
        let b = vec![0.0, 1.0];
        let sim = cosine(&a, &b);
        assert!(sim.abs() < 1e-5);
    }

    #[test]
    fn zero_vector() {
        let a = vec![0.0, 0.0];
        let b = vec![1.0, 2.0];
        assert_eq!(cosine(&a, &b), 0.0);
    }

    #[test]
    fn both_zero_vectors() {
        let a = vec![0.0, 0.0, 0.0];
        let b = vec![0.0, 0.0, 0.0];
        assert_eq!(cosine(&a, &b), 0.0);
    }

    #[test]
    fn opposite_vectors() {
        let a = vec![1.0, 0.0];
        let b = vec![-1.0, 0.0];
        let sim = cosine(&a, &b);
        assert!((sim - (-1.0)).abs() < 1e-5);
    }

    #[test]
    fn different_lengths_uses_shorter() {
        let a = vec![1.0, 0.0, 0.0, 0.0];
        let b = vec![1.0, 0.0];
        let sim = cosine(&a, &b);
        // dot product = 1.0, only first 2 elements considered
        assert!((sim - 1.0).abs() < 1e-5);
    }

    #[test]
    fn empty_vectors() {
        let a: Vec<f32> = vec![];
        let b: Vec<f32> = vec![];
        assert_eq!(cosine(&a, &b), 0.0);
    }

    #[test]
    fn similar_vectors_score_higher() {
        let target = vec![1.0, 1.0, 0.0];
        let close = vec![1.0, 0.9, 0.1];
        let far = vec![0.0, 0.0, 1.0];
        assert!(cosine(&target, &close) > cosine(&target, &far));
    }

    #[test]
    fn cosine_with_embeddings() {
        use crate::embedding::embed;
        let a = embed("rust programming language");
        let b = embed("rust programming language");
        let c = embed("cooking recipe for pasta");
        // Same input → identical → similarity = 1.0
        assert!((cosine(&a, &b) - 1.0).abs() < 1e-5);
        // Different inputs → lower similarity
        assert!(cosine(&a, &c) < 1.0);
    }
}
