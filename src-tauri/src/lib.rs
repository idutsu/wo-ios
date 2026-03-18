use tauri::Manager;
use tauri::path::BaseDirectory;
use std::fs;
use rusqlite::Connection;


#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let app_config_dir = app.path().app_data_dir().expect("AppDataが見つかりません");

            if !app_config_dir.exists() {
                fs::create_dir_all(&app_config_dir).expect("AppDataの作成に失敗しました");
            }

            let db_dest_path = app_config_dir.join("pairs.sqlite3");
            let resource_path = "../pairs.sqlite3";

            // ① 初回起動時：DBが存在しなければコピーする
            if !db_dest_path.exists() {
                match app.path().resolve(resource_path, BaseDirectory::Resource) {
                    Ok(db_src_path) => {
                        if db_src_path.exists() {
                            fs::copy(&db_src_path, &db_dest_path).expect("データベースのコピーに失敗しました");
                            println!("データベースの初回コピーが完了しました！");
                        }
                    }
                    Err(e) => eprintln!("リソースパスの解決に失敗しました: {}", e),
                }
            }

            // ② 起動ごとの同期処理（バージョンをチェックして必要な時だけ実行）
            if let Ok(db_src_path) = app.path().resolve(resource_path, BaseDirectory::Resource) {

                // Windowsのファイルロックを避けるため、同梱DBはバージョンを読むだけですぐ閉じる
                let src_version: i32 = if let Ok(conn_src) = Connection::open(&db_src_path) {
                    conn_src.query_row("PRAGMA user_version", [], |row| row.get(0)).unwrap_or(0)
                } else {
                    0
                };

                // ユーザー側のDBに接続
                if let Ok(conn_dest) = Connection::open(&db_dest_path) {
                    let dest_version: i32 = conn_dest.query_row("PRAGMA user_version", [], |row| row.get(0)).unwrap_or(0);

                    // 同梱DBのバージョンのほうが新しい場合のみ、同期を実行
                    if src_version > dest_version {
                        println!("新しい辞書データが見つかりました。(v{} -> v{}) 同期を開始します...", dest_version, src_version);

                        let attach_sql = format!(
                            "ATTACH DATABASE '{}' AS bundled_db",
                            db_src_path.to_str().unwrap()
                        );

                        if conn_dest.execute(&attach_sql, []).is_ok() {
                            // トランザクション開始
                            let _ = conn_dest.execute("BEGIN TRANSACTION", []);

                            // 古いデータを削除
                            let _ = conn_dest.execute("DELETE FROM wo_sudachi_normal", []);
                            let _ = conn_dest.execute("DELETE FROM wo_sudachi_sahen", []);

                            // 最新のDBからデータを一括流し込み
                            let _ = conn_dest.execute("INSERT INTO wo_sudachi_normal SELECT * FROM bundled_db.wo_sudachi_normal", []);
                            let _ = conn_dest.execute("INSERT INTO wo_sudachi_sahen SELECT * FROM bundled_db.wo_sudachi_sahen", []);

                            // ユーザー側のDBのバージョンを最新に更新
                            let _ = conn_dest.execute(&format!("PRAGMA user_version = {}", src_version), []);

                            // 確定
                            let _ = conn_dest.execute("COMMIT", []);

                            println!("開発者用テーブルを最新状態に同期しました！(バージョン: {})", src_version);
                        } else {
                            eprintln!("データベースのATTACHに失敗しました。");
                        }
                    } else {
                        println!("辞書データは最新です。(バージョン: {}) 同期をスキップしました。", dest_version);
                    }
                }
            }

            Ok(())
        })
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![greet])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
