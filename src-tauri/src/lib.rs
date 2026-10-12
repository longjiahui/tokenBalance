use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::sync::Mutex;
use tauri::{
    menu::{CheckMenuItem, IsMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent},
    webview::WebviewWindowBuilder,
    AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow,
};

#[derive(Serialize, Deserialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Connection {
    pub id: String,
    pub provider_id: String,
    pub name: String,
    pub api_key: String,
    pub base_url: Option<String>,
}

#[derive(Serialize, Deserialize, Default)]
pub struct Config {
    pub connections: Vec<Connection>,
}

fn config_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|dir| dir.join("config.json"))
        .map_err(|e| e.to_string())
}

fn read_connections(app: &AppHandle) -> Vec<Connection> {
    config_path(app)
        .ok()
        .and_then(|path| fs::read_to_string(path).ok())
        .and_then(|content| serde_json::from_str::<Config>(&content).ok())
        .map(|config| config.connections)
        .unwrap_or_default()
}

#[tauri::command]
fn load_config(app: AppHandle) -> Result<Config, String> {
    let path = config_path(&app)?;
    if !path.exists() {
        return Ok(Config::default());
    }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_config(app: AppHandle, config: Config) -> Result<(), String> {
    let path = config_path(&app)?;
    fs::create_dir_all(
        path.parent()
            .ok_or_else(|| "invalid config path".to_string())?,
    )
    .map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| e.to_string())
}

fn conn_label(id: &str) -> String {
    format!("conn-{id}")
}

const WIN_W: f64 = 300.0;
const WIN_H: f64 = 240.0;
const GAP: f64 = 12.0;

fn positions_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    config_path(app).map(|p| p.with_file_name("positions.json"))
}

fn load_positions(app: &AppHandle) -> HashMap<String, [f64; 2]> {
    positions_path(app)
        .ok()
        .and_then(|path| fs::read_to_string(path).ok())
        .and_then(|content| serde_json::from_str(&content).ok())
        .unwrap_or_default()
}

fn save_positions_map(app: &AppHandle, map: &HashMap<String, [f64; 2]>) {
    let Ok(path) = positions_path(app) else {
        return;
    };
    if let Some(dir) = path.parent() {
        let _ = fs::create_dir_all(dir);
    }
    if let Ok(json) = serde_json::to_string_pretty(map) {
        let _ = fs::write(path, json);
    }
}

struct WindowPositions {
    map: Mutex<HashMap<String, (f64, f64)>>,
    dirty: Mutex<bool>,
}

fn monitor_rects(app: &AppHandle) -> Vec<(f64, f64, f64, f64)> {
    app.available_monitors()
        .map(|monitors| {
            monitors
                .iter()
                .map(|m| {
                    (
                        m.position().x as f64,
                        m.position().y as f64,
                        m.size().width as f64,
                        m.size().height as f64,
                    )
                })
                .collect()
        })
        .unwrap_or_default()
}

/// 窗口矩形与任一显示器有足够可见面积即认为位置合法
fn position_visible(
    x: f64,
    y: f64,
    w: f64,
    h: f64,
    monitors: &[(f64, f64, f64, f64)],
) -> bool {
    monitors.iter().any(|(mx, my, mw, mh)| {
        let ix = (x + w).min(mx + mw) - x.max(*mx);
        let iy = (y + h).min(my + mh) - y.max(*my);
        ix >= 60.0 && iy >= 40.0
    })
}

/// 主显示器右上角竖直排列：右对齐、留间隙，超出屏幕高度后向左换列
fn stack_position(app: &AppHandle, index: usize) -> (f64, f64) {
    let (mx, my, mw, mh) = app
        .primary_monitor()
        .ok()
        .flatten()
        .map(|m| {
            (
                m.position().x as f64,
                m.position().y as f64,
                m.size().width as f64,
                m.size().height as f64,
            )
        })
        .unwrap_or((0.0, 0.0, 1920.0, 1080.0));
    let per_col = (((mh - 2.0 * GAP) / (WIN_H + GAP)).floor() as usize).max(1);
    let col = (index / per_col) as f64;
    let row = (index % per_col) as f64;
    (
        mx + mw - WIN_W - GAP - col * (WIN_W + GAP),
        my + GAP + row * (WIN_H + GAP),
    )
}

/// 启动时校验记忆的位置：不合法（拔掉显示器、分辨率变化等）则重新分配到右上角
fn resolve_initial_positions(
    app: &AppHandle,
    conns: &[Connection],
) -> HashMap<String, (f64, f64)> {
    let saved = load_positions(app);
    let monitors = monitor_rects(app);
    let mut result = HashMap::new();
    let mut stack_index = 0usize;
    for conn in conns {
        let pos = saved
            .get(&conn.id)
            .and_then(|p| {
                let (x, y) = (p[0], p[1]);
                position_visible(x, y, WIN_W, WIN_H, &monitors).then_some((x, y))
            });
        let pos = match pos {
            Some(p) => p,
            None => {
                let p = stack_position(app, stack_index);
                stack_index += 1;
                p
            }
        };
        result.insert(conn.id.clone(), pos);
    }
    result
}

fn window_visible(app: &AppHandle, label: &str) -> bool {
    app.get_webview_window(label)
        .and_then(|w| w.is_visible().ok())
        .unwrap_or(false)
}

/// 打开（或聚焦）某个连接的独立小窗
fn show_connection_window(
    app: &AppHandle,
    conn: &Connection,
    pos: (f64, f64),
) -> tauri::Result<()> {
    let label = conn_label(&conn.id);
    if let Some(window) = app.get_webview_window(&label) {
        window.show()?;
        window.set_focus()?;
        return Ok(());
    }
    let window = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("conn.html".into()))
        .title(&conn.name)
        .inner_size(WIN_W, WIN_H)
        .min_inner_size(200.0, 140.0)
        .resizable(true)
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false)
        .build()?;
    window.set_position(tauri::PhysicalPosition::new(
        pos.0.round() as i32,
        pos.1.round() as i32,
    ))?;
    window.show()?;
    window.set_focus()?;
    if let Some(state) = app.try_state::<WindowPositions>() {
        state.map.lock().unwrap().insert(conn.id.clone(), pos);
        *state.dirty.lock().unwrap() = true;
    }
    Ok(())
}

fn toggle_connection_window(app: &AppHandle, id: &str) {
    let label = conn_label(id);
    let visible = window_visible(app, &label);
    if visible {
        if let Some(window) = app.get_webview_window(&label) {
            let _ = window.hide();
        }
    } else if let Some(conn) = read_connections(app).into_iter().find(|c| c.id == id) {
        let pos = load_positions(app)
            .get(id)
            .and_then(|p| {
                let (x, y) = (p[0], p[1]);
                position_visible(x, y, WIN_W, WIN_H, &monitor_rects(app)).then_some((x, y))
            })
            .unwrap_or_else(|| {
                let count = app
                    .webview_windows()
                    .keys()
                    .filter(|l| l.starts_with("conn-"))
                    .count();
                stack_position(app, count)
            });
        let _ = show_connection_window(app, &conn, pos);
    }
    sync_conn_check(app, id, !visible);
}

/// 左键托盘图标：有窗口可见则全部隐藏，否则全部显示
fn toggle_all_windows(app: &AppHandle) {
    let conn_windows: Vec<WebviewWindow> = app
        .webview_windows()
        .into_iter()
        .filter(|(label, _)| label.starts_with("conn-"))
        .map(|(_, window)| window)
        .collect();
    let any_visible = conn_windows
        .iter()
        .any(|w| w.is_visible().unwrap_or(false));
    for window in &conn_windows {
        if any_visible {
            let _ = window.hide();
        } else {
            let _ = window.show();
            let _ = window.set_focus();
        }
    }
    if let Some(state) = app.try_state::<TrayState>() {
        for (id, item) in state.conn_items.lock().unwrap().iter() {
            let _ = item.set_checked(!any_visible && window_visible(app, &conn_label(id)));
        }
    }
}

fn sync_conn_check(app: &AppHandle, id: &str, checked: bool) {
    if let Some(state) = app.try_state::<TrayState>() {
        if let Some(item) = state.conn_items.lock().unwrap().get(id) {
            let _ = item.set_checked(checked);
        }
    }
}

struct TrayState {
    tray: TrayIcon,
    conn_items: Mutex<HashMap<String, CheckMenuItem<tauri::Wry>>>,
}

/// 根据配置文件重建托盘菜单：全部刷新 / 添加连接 / 分割线 / 各连接（checked = 窗口可见）
fn rebuild_tray(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<TrayState>();
    let err = |e: tauri::Error| e.to_string();

    let refresh_item =
        MenuItem::with_id(app, "refresh-all", "全部刷新", true, None::<&str>).map_err(err)?;
    let add_item =
        MenuItem::with_id(app, "add", "添加连接", true, None::<&str>).map_err(err)?;
    let separator = PredefinedMenuItem::separator(app).map_err(err)?;
    let quit_separator = PredefinedMenuItem::separator(app).map_err(err)?;
    let quit_item =
        MenuItem::with_id(app, "quit", "退出", true, None::<&str>).map_err(err)?;

    let mut items: Vec<&dyn IsMenuItem<tauri::Wry>> =
        vec![&refresh_item, &add_item, &separator];

    let mut new_items: HashMap<String, CheckMenuItem<tauri::Wry>> = HashMap::new();
    for conn in read_connections(app) {
        let visible = window_visible(app, &conn_label(&conn.id));
        let item = CheckMenuItem::with_id(
            app,
            conn_label(&conn.id),
            conn.name.clone(),
            true,
            visible,
            None::<&str>,
        )
        .map_err(err)?;
        new_items.insert(conn.id.clone(), item);
    }
    for item in new_items.values() {
        items.push(item);
    }
    items.push(&quit_separator);
    items.push(&quit_item);

    let menu = Menu::with_items(app, &items).map_err(err)?;
    state.tray.set_menu(Some(menu)).map_err(err)?;
    *state.conn_items.lock().unwrap() = new_items;
    Ok(())
}

#[tauri::command]
fn open_add(app: AppHandle) {
    if let Some(window) = app.get_webview_window("add") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// 隐藏调用方窗口；连接窗口隐藏时同步托盘勾选状态
#[tauri::command]
fn hide_window(window: WebviewWindow) {
    let _ = window.hide();
    if let Some(id) = window.label().strip_prefix("conn-") {
        sync_conn_check(window.app_handle(), id, false);
    }
}

#[tauri::command]
fn open_connection_window(app: AppHandle, id: String) -> Result<(), String> {
    let conn = read_connections(&app)
        .into_iter()
        .find(|c| c.id == id)
        .ok_or_else(|| "连接不存在".to_string())?;
    let index = app
        .webview_windows()
        .keys()
        .filter(|l| l.starts_with("conn-"))
        .count();
    show_connection_window(&app, &conn, stack_position(&app, index))
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn close_connection_window(app: AppHandle, id: String) {
    if let Some(window) = app.get_webview_window(&conn_label(&id)) {
        let _ = window.close();
    }
}

#[tauri::command]
fn refresh_tray(app: AppHandle) -> Result<(), String> {
    rebuild_tray(&app)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            let app: &AppHandle = app;
            toggle_all_windows(app);
            // 一个连接都没有时，第二次启动直接打开添加窗口
            if read_connections(app).is_empty() {
                if let Some(window) = app.get_webview_window("add") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        }))
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            load_config,
            save_config,
            open_add,
            hide_window,
            open_connection_window,
            close_connection_window,
            refresh_tray
        ])
        .setup(|app| {
            let tray = TrayIconBuilder::with_id("main")
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Token Balance")
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "add" => {
                        if let Some(window) = app.get_webview_window("add") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "refresh-all" => {
                        let _ = app.emit("refresh-all", ());
                    }
                    "quit" => app.exit(0),
                    other => {
                        if let Some(id) = other.strip_prefix("conn-") {
                            toggle_connection_window(app, id);
                        }
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        toggle_all_windows(tray.app_handle());
                    }
                })
                .build(app)?;

            app.manage(TrayState {
                tray,
                conn_items: Mutex::new(HashMap::new()),
            });
            app.manage(WindowPositions {
                map: Mutex::new(HashMap::new()),
                dirty: Mutex::new(false),
            });

            // 启动时为每个已保存的连接创建窗口：校验记忆位置，非法则重新排布
            let conns = read_connections(app.handle());
            let positions = resolve_initial_positions(app.handle(), &conns);
            for conn in &conns {
                let pos = positions.get(&conn.id).copied().unwrap_or((160.0, 140.0));
                let _ = show_connection_window(app.handle(), conn, pos);
            }
            rebuild_tray(app.handle())?;

            // 后台线程：位置变更后延迟落盘，避免拖动时频繁写文件
            let handle = app.handle().clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(std::time::Duration::from_millis(1500));
                let state = handle.state::<WindowPositions>();
                {
                    let mut dirty = state.dirty.lock().unwrap();
                    if !*dirty {
                        continue;
                    }
                    *dirty = false;
                }
                let map: HashMap<String, [f64; 2]> = state
                    .map
                    .lock()
                    .unwrap()
                    .iter()
                    .map(|(k, (x, y))| (k.clone(), [*x, *y]))
                    .collect();
                drop(state);
                save_positions_map(&handle, &map);
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            // 连接窗口移动后记忆位置（延迟落盘）
            if let tauri::WindowEvent::Moved(pos) = event {
                let label = window.label();
                if label.starts_with("conn-") {
                    let app = window.app_handle();
                    if let Some(state) = app.try_state::<WindowPositions>() {
                        state
                            .map
                            .lock()
                            .unwrap()
                            .insert(label.to_string(), (pos.x as f64, pos.y as f64));
                        *state.dirty.lock().unwrap() = true;
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
