use std::env;
use std::fs;
use std::path::PathBuf;

fn main() {
    println!("cargo:rerun-if-changed=openapi.json");

    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"));
    let spec_path = manifest_dir.join("openapi.json");
    let spec = fs::read_to_string(&spec_path)
        .unwrap_or_else(|err| panic!("failed to read {}: {err}", spec_path.display()));
    let spec: serde_json::Value = serde_json::from_str(&spec)
        .unwrap_or_else(|err| panic!("{} is not valid JSON: {err}", spec_path.display()));
    let version = spec
        .pointer("/info/version")
        .and_then(|v| v.as_str())
        .unwrap_or_else(|| panic!("{} has no string info.version", spec_path.display()));

    println!("cargo:rustc-env=SATORA_SERVER_VERSION={version}");
}
