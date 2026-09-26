use serde::{Serialize, Serializer};

/// Every error that can cross the IPC boundary. Messages are shown to the user verbatim,
/// so they should say what went wrong in plain terms and keep the OS error text intact.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{0}")]
    Io(#[from] std::io::Error),

    #[error("OSC encode failed: {0}")]
    OscEncode(String),

    #[error("invalid OSC address '{address}': {reason}")]
    InvalidAddress {
        address: String,
        reason: &'static str,
    },

    #[error("invalid network config: {0}")]
    Config(String),

    #[error("preset error: {0}")]
    Preset(String),

    #[error("{0}")]
    InvalidPath(String),

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("{0}")]
    Tauri(#[from] tauri::Error),
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;
