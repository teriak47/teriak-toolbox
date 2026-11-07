//! Port of `recoverLegacyDatabase()` (former server/db.ts), for browser mode. Earlier
//! versions on Windows opened `surrealkv://D:/…/data/graphax.db`, which created the database
//! under `<start folder>/D/…/data/graphax.db`. If the database is missing at the expected
//! place but found there, it is copied over; the original is never modified or removed.

use std::path::{Path, PathBuf};

/// Where an earlier version started from `start_dir` put its database, when that folder is
/// on a Windows drive
pub fn legacy_location(start_dir: &str) -> Option<PathBuf> {
    let old_file = format!(
        "{}/data/graphax.db",
        start_dir.replace('\\', "/").trim_end_matches('/')
    );
    let (drive, rest) = old_file.split_once(":/")?;
    if drive.len() != 1 || !drive.chars().all(|c| c.is_ascii_alphabetic()) {
        return None;
    }
    Some(Path::new(start_dir).join(drive).join(rest))
}

fn copy_dir(from: &Path, to: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let target = to.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir(&entry.path(), &target)?;
        } else {
            std::fs::copy(entry.path(), target)?;
        }
    }
    Ok(())
}

/// Copies a database left by an earlier version to `db_file`, when `db_file` is missing
pub fn recover_legacy_database(db_file: &Path, start_dirs: &[PathBuf]) {
    if db_file.exists() {
        return;
    }
    for start_dir in start_dirs {
        let Some(candidate) = legacy_location(&start_dir.to_string_lossy()) else {
            continue;
        };
        if candidate == db_file || !candidate.exists() {
            continue;
        }
        match copy_dir(&candidate, db_file) {
            Ok(()) => eprintln!(
                "[Graphax DB] Ancienne base trouvée dans {} ; copiée vers {}. L'original n'a pas été modifié.",
                candidate.display(),
                db_file.display()
            ),
            Err(err) => eprintln!("[Graphax DB] Copie de l'ancienne base impossible : {err}"),
        }
        return;
    }
}
