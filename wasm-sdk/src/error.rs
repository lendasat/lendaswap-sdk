//! Error conversion utilities for WASM.

use wasm_bindgen::prelude::*;

/// Convert a Result to a JsValue error.
pub fn to_js_error<E: std::fmt::Display>(err: E) -> JsValue {
    JsValue::from_str(&format!("{}", err))
}

/// Macro to convert Rust errors to JavaScript values.
#[macro_export]
macro_rules! map_err_to_js {
    ($expr:expr) => {
        $expr.map_err(|e| JsValue::from_str(&format!("{:#}", e)))
    };
}
