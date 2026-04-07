/// Produce a deterministic 128-dimensional embedding vector.
/// Characters are mapped to bucket indices and the result is L2-normalised.
/// This is a placeholder — swap in a real model later.
pub fn embed(text: &str) -> Vec<f32> {
    let mut vec = vec![0.0; 128];

    for (i, ch) in text.chars().enumerate() {
        let idx = (ch as usize + i) % 128;
        vec[idx] += 1.0;
    }

    let norm = vec.iter().map(|x| x * x).sum::<f32>().sqrt();
    if norm > 0.0 {
        for v in vec.iter_mut() {
            *v /= norm;
        }
    }

    vec
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embed_produces_fixed_length() {
        let v = embed("hello world");
        assert_eq!(v.len(), 128);
    }

    #[test]
    fn embed_is_normalised() {
        let v = embed("some text");
        let norm: f32 = v.iter().map(|x| x * x).sum::<f32>().sqrt();
        assert!((norm - 1.0).abs() < 1e-5);
    }

    #[test]
    fn embed_empty_string() {
        let v = embed("");
        assert_eq!(v.len(), 128);
        assert!(v.iter().all(|&x| x == 0.0));
    }

    #[test]
    fn embed_is_deterministic() {
        let a = embed("reproducible input");
        let b = embed("reproducible input");
        assert_eq!(a, b);
    }

    #[test]
    fn embed_different_inputs_differ() {
        let a = embed("hello");
        let b = embed("world");
        assert_ne!(a, b);
    }

    #[test]
    fn embed_single_char() {
        let v = embed("a");
        assert_eq!(v.len(), 128);
        let norm: f32 = v.iter().map(|x| x * x).sum::<f32>().sqrt();
        assert!((norm - 1.0).abs() < 1e-5);
    }

    #[test]
    fn embed_long_text_stays_normalised() {
        let text = "a]".repeat(1000);
        let v = embed(&text);
        assert_eq!(v.len(), 128);
        let norm: f32 = v.iter().map(|x| x * x).sum::<f32>().sqrt();
        assert!((norm - 1.0).abs() < 1e-5);
    }

    #[test]
    fn embed_unicode() {
        let v = embed("こんにちは世界");
        assert_eq!(v.len(), 128);
        let norm: f32 = v.iter().map(|x| x * x).sum::<f32>().sqrt();
        assert!((norm - 1.0).abs() < 1e-5);
    }

    #[test]
    fn embed_all_values_non_negative() {
        let v = embed("test non-negative");
        assert!(v.iter().all(|&x| x >= 0.0));
    }
}
