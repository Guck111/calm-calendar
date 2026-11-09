use serde::{Serialize, Serializer, ser::SerializeStruct};

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("Google OAuth client is not configured")]
    NotConfigured,
    #[error("Not signed in to Google")]
    NotSignedIn,
    #[error("Sign-in denied: {0}")]
    Denied(String),
    #[error("Sign-in timed out")]
    Timeout,
    #[error("Calendar scopes were not granted")]
    MissingScope,
    // интерфейс разбирает «403: текст» и пишет своё сообщение с кодом
    #[error("{status}: {message}")]
    Google { status: u16, message: String },
    #[error("Network: {0}")]
    Network(String),
    #[error("{0}")]
    Other(String),
}

impl Error {
    pub fn kind(&self) -> &'static str {
        match self {
            Error::NotConfigured => "not_configured",
            Error::NotSignedIn => "not_signed_in",
            Error::Denied(_) => "denied",
            Error::Timeout => "timeout",
            Error::MissingScope => "missing_scope",
            Error::Google { .. } => "google",
            Error::Network(_) => "network",
            Error::Other(_) => "other",
        }
    }
}

// Во фронтенд ошибка уходит объектом { kind, message }
impl Serialize for Error {
    fn serialize<S: Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        let mut st = s.serialize_struct("Error", 2)?;
        st.serialize_field("kind", self.kind())?;
        st.serialize_field("message", &self.to_string())?;
        st.end()
    }
}

impl From<reqwest::Error> for Error {
    fn from(e: reqwest::Error) -> Self {
        Error::Network(e.to_string())
    }
}

impl From<std::io::Error> for Error {
    fn from(e: std::io::Error) -> Self {
        Error::Other(e.to_string())
    }
}

impl From<keyring::Error> for Error {
    fn from(e: keyring::Error) -> Self {
        Error::Other(format!("Credential store: {e}"))
    }
}

impl From<serde_json::Error> for Error {
    fn from(e: serde_json::Error) -> Self {
        Error::Other(e.to_string())
    }
}

impl From<url::ParseError> for Error {
    fn from(e: url::ParseError) -> Self {
        Error::Other(e.to_string())
    }
}

pub type Result<T> = std::result::Result<T, Error>;
