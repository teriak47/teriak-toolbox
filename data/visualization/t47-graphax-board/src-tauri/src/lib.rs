// Step 1 of the desktop migration: the window shows the existing React front end.
// In development it loads the Vite server, which still proxies /api to the Node server.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("Graphax n'a pas pu démarrer");
}
