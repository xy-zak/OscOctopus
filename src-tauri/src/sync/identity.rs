//! Who this device is, and what proves it belongs to a session.
//!
//! - The device identity is a persistent X25519 key pair (the Noise static key). Its `peer_id`
//!   is a hash of the public key, so a peer can't claim someone else's id.
//! - The session key (PSK) is derived with Argon2id from the session name and its secret.
//!   The secret is a generated key by default, or a typed passphrase.
//!
//! The secret is never stored. With *Remember*, only the derived key is saved, in the app's
//! data dir. It never goes back to the webview.

use std::fs;
use std::path::Path;

use argon2::{Algorithm, Argon2, Params, Version};
use blake2::{Blake2s256, Digest};
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::files::write_atomic;

pub const NOISE_PARAMS: &str = "Noise_XXpsk3_25519_ChaChaPoly_BLAKE2s";
/// Typed passphrases shorter than this are refused (generated keys are far longer).
pub const MIN_SECRET_CHARS: usize = 8;

pub(crate) fn blake2s(data: &[u8]) -> [u8; 32] {
    Blake2s256::digest(data).into()
}

pub(crate) fn to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn from_hex(s: &str) -> Option<Vec<u8>> {
    if s.len() % 2 != 0 {
        return None;
    }
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).ok())
        .collect()
}

pub(crate) fn random_bytes<const N: usize>() -> [u8; N] {
    let mut out = [0u8; N];
    getrandom::fill(&mut out).expect("the OS random number generator failed");
    out
}

/// The id of the device whose Noise static public key is `public`.
pub fn peer_id_of(public: &[u8]) -> String {
    to_hex(&blake2s(public)[..8])
}

#[derive(Serialize, Deserialize)]
struct IdentityFile {
    private: String,
    public: String,
}

#[derive(Clone)]
pub struct Identity {
    private: Vec<u8>,
    public: Vec<u8>,
    peer_id: String,
}

impl Identity {
    pub fn generate() -> Self {
        let keys = snow::Builder::new(NOISE_PARAMS.parse().expect("valid noise params"))
            .generate_keypair()
            .expect("key generation");
        let peer_id = peer_id_of(&keys.public);
        Self {
            private: keys.private,
            public: keys.public,
            peer_id,
        }
    }

    /// Loads the device key from `path`, or creates and saves a new one.
    pub fn load_or_create(path: &Path) -> AppResult<Self> {
        if let Ok(text) = fs::read_to_string(path) {
            let file: IdentityFile = serde_json::from_str(&text)?;
            let (Some(private), Some(public)) = (from_hex(&file.private), from_hex(&file.public))
            else {
                return Err(AppError::InvalidPath(format!(
                    "{} is damaged; delete it to create a new device identity",
                    path.display()
                )));
            };
            let peer_id = peer_id_of(&public);
            return Ok(Self {
                private,
                public,
                peer_id,
            });
        }
        let identity = Self::generate();
        let file = IdentityFile {
            private: to_hex(&identity.private),
            public: to_hex(&identity.public),
        };
        if let Some(dir) = path.parent() {
            fs::create_dir_all(dir)?;
        }
        write_atomic(path, &serde_json::to_vec_pretty(&file)?)?;
        restrict(path);
        Ok(identity)
    }

    pub fn private(&self) -> &[u8] {
        &self.private
    }

    pub fn peer_id(&self) -> &str {
        &self.peer_id
    }

    /// The peer id in groups of four, for comparing devices by eye.
    pub fn fingerprint(&self) -> String {
        fingerprint_of(&self.peer_id)
    }
}

pub fn fingerprint_of(peer_id: &str) -> String {
    peer_id
        .as_bytes()
        .chunks(4)
        .map(|c| String::from_utf8_lossy(c).into_owned())
        .collect::<Vec<_>>()
        .join("-")
}

/// Only the owner may read a file holding key material (a no-op where the OS has no modes).
fn restrict(path: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
    }
    #[cfg(not(unix))]
    let _ = path;
}

/// A session name compares case-insensitively and ignores surrounding spaces.
pub fn normalize_session(name: &str) -> String {
    name.trim().to_lowercase()
}

/// Sent in the clear before the handshake, so a peer in another session is told apart
/// immediately. It is not secret: session names aren't.
pub fn session_hash(name: &str) -> [u8; 8] {
    let digest = blake2s(format!("oscoctopus-disc/{}", normalize_session(name)).as_bytes());
    digest[..8].try_into().unwrap()
}

const BASE32: &[u8; 32] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/// A new session key: 128 random bits, written as 26 base32 characters in groups of four.
pub fn new_session_key() -> String {
    let bytes: [u8; 16] = random_bytes();
    let mut bits: u32 = 0;
    let mut nbits = 0;
    let mut chars = String::new();
    for b in bytes {
        bits = (bits << 8) | b as u32;
        nbits += 8;
        while nbits >= 5 {
            chars.push(BASE32[((bits >> (nbits - 5)) & 31) as usize] as char);
            nbits -= 5;
        }
    }
    if nbits > 0 {
        chars.push(BASE32[((bits << (5 - nbits)) & 31) as usize] as char);
    }
    chars
        .as_bytes()
        .chunks(4)
        .map(|c| String::from_utf8_lossy(c).into_owned())
        .collect::<Vec<_>>()
        .join("-")
}

/// A generated key reads the same however it is typed (any case, with or without dashes or
/// spaces); a passphrase only loses surrounding whitespace.
pub fn normalize_secret(secret: &str) -> String {
    let compact: String = secret
        .chars()
        .filter(|c| !c.is_whitespace() && *c != '-')
        .collect::<String>()
        .to_ascii_uppercase();
    let is_key = compact.len() == 26 && compact.bytes().all(|b| BASE32.contains(&b));
    if is_key {
        compact
    } else {
        secret.trim().to_string()
    }
}

/// The session's pre-shared key: Argon2id over the secret, salted with the session name, so
/// the same secret in another session gives another key.
pub fn derive_psk(session: &str, secret: &str) -> AppResult<[u8; 32]> {
    let secret = normalize_secret(secret);
    if secret.chars().count() < MIN_SECRET_CHARS {
        return Err(AppError::Config(format!(
            "the session key must be at least {MIN_SECRET_CHARS} characters"
        )));
    }
    if normalize_session(session).is_empty() {
        return Err(AppError::Config("the session needs a name".into()));
    }
    let salt =
        &blake2s(format!("oscoctopus-sync-v1/{}", normalize_session(session)).as_bytes())[..16];
    let params = Params::new(19 * 1024, 2, 1, Some(32))
        .map_err(|e| AppError::Config(format!("key derivation: {e}")))?;
    let mut psk = [0u8; 32];
    Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
        .hash_password_into(secret.as_bytes(), salt, &mut psk)
        .map_err(|e| AppError::Config(format!("key derivation: {e}")))?;
    Ok(psk)
}

/// A session remembered on this device: its name and derived key (never the secret).
#[derive(Serialize, Deserialize)]
pub struct RememberedSession {
    pub session: String,
    psk: String,
}

impl RememberedSession {
    pub fn new(session: &str, psk: &[u8; 32]) -> Self {
        Self {
            session: session.to_string(),
            psk: to_hex(psk),
        }
    }

    pub fn psk(&self) -> Option<[u8; 32]> {
        from_hex(&self.psk)?.try_into().ok()
    }

    pub fn load(path: &Path) -> Option<Self> {
        serde_json::from_str(&fs::read_to_string(path).ok()?).ok()
    }

    pub fn save(&self, path: &Path) -> AppResult<()> {
        if let Some(dir) = path.parent() {
            fs::create_dir_all(dir)?;
        }
        write_atomic(path, &serde_json::to_vec_pretty(self)?)?;
        restrict(path);
        Ok(())
    }

    pub fn forget(path: &Path) {
        let _ = fs::remove_file(path);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn peer_id_is_the_hash_of_the_key() {
        let a = Identity::generate();
        assert_eq!(a.peer_id(), peer_id_of(&a.public));
        assert_eq!(a.peer_id().len(), 16);
        assert_ne!(a.peer_id(), Identity::generate().peer_id());
        assert_eq!(fingerprint_of("0123456789abcdef"), "0123-4567-89ab-cdef");
    }

    #[test]
    fn identity_survives_a_restart() {
        let dir = std::env::temp_dir().join(format!("osc-octopus-id-{}", std::process::id()));
        let path = dir.join("identity.key");
        let _ = fs::remove_dir_all(&dir);
        let first = Identity::load_or_create(&path).unwrap();
        let again = Identity::load_or_create(&path).unwrap();
        assert_eq!(first.peer_id(), again.peer_id());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn generated_keys_read_the_same_however_typed() {
        let key = new_session_key();
        assert_eq!(key.len(), 26 + 6, "26 chars in groups of 4");
        let typed = key.to_lowercase().replace('-', " ");
        assert_eq!(normalize_secret(&typed), normalize_secret(&key));
        assert_eq!(normalize_secret("  my pass phrase "), "my pass phrase");
        assert_ne!(new_session_key(), key);
    }

    #[test]
    fn psk_depends_on_session_and_secret() {
        let a = derive_psk("Stage", "correct horse").unwrap();
        assert_eq!(
            a,
            derive_psk(" stage ", "correct horse").unwrap(),
            "session name normalised"
        );
        assert_ne!(a, derive_psk("Stage 2", "correct horse").unwrap());
        assert_ne!(a, derive_psk("Stage", "correct horsE").unwrap());
        assert!(derive_psk("Stage", "short").is_err());
        assert!(derive_psk("  ", "long enough secret").is_err());
    }

    #[test]
    fn session_hash_ignores_case() {
        assert_eq!(session_hash("Stage"), session_hash("stage "));
        assert_ne!(session_hash("Stage"), session_hash("Studio"));
    }
}
