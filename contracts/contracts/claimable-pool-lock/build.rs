use std::fs;
use std::path::Path;
use std::process::Command;

fn main() {
    let schema_path = Path::new("schemas/claimable-pool-lock.mol");
    let output_dir = Path::new("src/generated");
    let output_path = output_dir.join("claimable_pool_lock.rs");

    println!("cargo:rerun-if-changed={}", schema_path.display());

    fs::create_dir_all(output_dir).expect("failed to create generated directory");

    let output = Command::new("moleculec")
        .arg("--language")
        .arg("rust")
        .arg("--schema-file")
        .arg(schema_path)
        .output()
        .expect("failed to execute moleculec");

    if !output.status.success() {
        panic!(
            "moleculec failed to compile schema {}: {}",
            schema_path.display(),
            String::from_utf8_lossy(&output.stderr)
        );
    }

    fs::write(&output_path, &output.stdout).expect("failed to write generated molecule file");
}
