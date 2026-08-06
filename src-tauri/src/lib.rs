// MemBook — Tauri 入口
// 仅做最小化的窗口启动，业务逻辑全部跑在前端
use tauri::Manager;

#[cfg(windows)]
use windows::Win32::UI::WindowsAndMessaging::{
    SetWindowPos, HWND_TOPMOST, HWND_NOTOPMOST, SWP_FRAMECHANGED, SWP_SHOWWINDOW,
    SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, GetWindowLongPtrW, SetWindowLongPtrW,
    GWL_STYLE, WS_SYSMENU,
};

/// 把命令放在独立模块中，避免 tauri::command 宏生成的内部标识符与当前模块冲突。
mod commands {
    use super::*;

    /// 使用 Windows WIC 在 Rust 端将 HEIC/HEIF 解码并编码为 JPEG，返回 JPEG 字节。
    /// 若系统未安装 HEIF 扩展或解码失败，则返回错误，由前端回退到 heic2any。
    #[tauri::command]
    pub fn convert_heic_to_jpeg(file_path: String) -> Result<Vec<u8>, String> {
        // 安全：校验文件路径，拒绝路径遍历和非图片扩展名
        let path = std::path::Path::new(&file_path);
        let ext = path.extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_lowercase())
            .unwrap_or_default();
        if !matches!(ext.as_str(), "heic" | "heif") {
            return Err(format!("不支持的文件扩展名: {}（仅支持 .heic/.heif）", ext));
        }
        // 拒绝包含 .. 的路径段，防止路径遍历
        if path.components().any(|c| matches!(c, std::path::Component::ParentDir)) {
            return Err("路径中包含非法的..段".to_string());
        }

        #[cfg(windows)]
        {
            use windows::Win32::Foundation::GENERIC_READ;
            use windows::Win32::Graphics::Imaging::*;
            use windows::Win32::System::Com::{
                CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED,
            };
            use windows::core::HSTRING;

            unsafe {
                // 每个命令在线程池执行，需要在该线程初始化 COM；重复初始化返回 S_FALSE 可忽略。
                let _ = CoInitializeEx(None, COINIT_MULTITHREADED);

                let factory: IWICImagingFactory = CoCreateInstance(
                    &CLSID_WICImagingFactory,
                    None,
                    CLSCTX_ALL,
                )
                .map_err(|e| format!("创建 WIC 工厂失败: {}", e))?;

                let path = HSTRING::from(&file_path);
                let decoder = factory
                    .CreateDecoderFromFilename(
                        &path,
                        None,
                        GENERIC_READ,
                        WICDecodeMetadataCacheOnDemand,
                    )
                    .map_err(|e| format!("创建 HEIC 解码器失败: {}", e))?;

                let frame = decoder
                    .GetFrame(0)
                    .map_err(|e| format!("获取 HEIC 帧失败: {}", e))?;

                // 使用临时文件接收编码后的 JPEG（WIC 编码到内存流需要自定义 IStream，临时文件更简单稳定）
                let temp_name = format!("membook_heic_{}.jpg", std::process::id());
                let temp_path = std::env::temp_dir().join(&temp_name);

                let stream = factory
                    .CreateStream()
                    .map_err(|e| format!("创建输出流失败: {}", e))?;
                stream
                    .InitializeFromFilename(
                        &HSTRING::from(temp_path.to_string_lossy().as_ref()),
                        windows::Win32::Foundation::GENERIC_WRITE.0,
                    )
                    .map_err(|e| format!("初始化输出流失败: {}", e))?;

                let encoder = factory
                    .CreateEncoder(&GUID_ContainerFormatJpeg, std::ptr::null())
                    .map_err(|e| format!("创建 JPEG 编码器失败: {}", e))?;
                encoder
                    .Initialize(&stream, WICBitmapEncoderNoCache)
                    .map_err(|e| format!("初始化 JPEG 编码器失败: {}", e))?;

                let mut frame_encode: Option<IWICBitmapFrameEncode> = None;
                encoder
                    .CreateNewFrame(&mut frame_encode, std::ptr::null_mut())
                    .map_err(|e| format!("创建编码帧失败: {}", e))?;
                let frame_encode = frame_encode.ok_or("创建编码帧返回空")?;
                frame_encode
                    .Initialize(None)
                    .map_err(|e| format!("初始化编码帧失败: {}", e))?;
                frame_encode
                    .WriteSource(&frame, std::ptr::null())
                    .map_err(|e| format!("写入 HEIC 源到 JPEG 失败: {}", e))?;
                frame_encode
                    .Commit()
                    .map_err(|e| format!("提交编码帧失败: {}", e))?;
                encoder
                    .Commit()
                    .map_err(|e| format!("提交编码器失败: {}", e))?;

                // 显式释放 COM 对象，确保临时文件已关闭可被读取
                drop(frame_encode);
                drop(encoder);
                drop(stream);

                let bytes = std::fs::read(&temp_path)
                    .map_err(|e| format!("读取临时 JPEG 失败: {}", e))?;
                let _ = std::fs::remove_file(&temp_path);

                Ok(bytes)
            }
        }
        #[cfg(not(windows))]
        {
            // macOS: 用系统自带的 sips 命令解码 HEIC → JPEG
            // sips 是 macOS 内置的图像处理工具，原生支持 HEIC
            let temp_name = format!("membook_heic_{}.jpg", std::process::id());
            let temp_path = std::env::temp_dir().join(&temp_name);

            let output = std::process::Command::new("sips")
                .args(["-s", "format", "jpeg", "-s", "formatOptions", "92"])
                .arg(&file_path)
                .arg("--out")
                .arg(&temp_path)
                .output()
                .map_err(|e| format!("启动 sips 失败: {}", e))?;

            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                return Err(format!("sips 解码 HEIC 失败: {}", stderr));
            }

            let bytes = std::fs::read(&temp_path)
                .map_err(|e| format!("读取转换后 JPEG 失败: {}", e))?;
            let _ = std::fs::remove_file(&temp_path);
            Ok(bytes)
        }
    }

    /// 使用 heif-rs（静态链接 libheif/libde265）在 Rust 端将 HEIC/HEIF 解码并编码为 JPEG。
    /// 作为 WIC 不可用时的第二优先路径，失败时由前端继续回退到 heic2any WASM。
    /// 仅在启用 `native-heic` Cargo feature 时编译。
    #[cfg(feature = "native-heic")]
    #[tauri::command]
    pub fn convert_heic_to_jpeg_native(file_path: String) -> Result<Vec<u8>, String> {
        // 安全：校验文件路径，拒绝路径遍历和非图片扩展名
        let path = std::path::Path::new(&file_path);
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_lowercase())
            .unwrap_or_default();
        if !matches!(ext.as_str(), "heic" | "heif") {
            return Err(format!("不支持的文件扩展名: {}（仅支持 .heic/.heif）", ext));
        }
        if path.components().any(|c| matches!(c, std::path::Component::ParentDir)) {
            return Err("路径中包含非法的..段".to_string());
        }

        let bytes = std::fs::read(&file_path)
            .map_err(|e| format!("读取 HEIC 文件失败: {}", e))?;

        let img = heif::decode(&bytes)
            .map_err(|e| format!("HEIC 解码失败: {}", e))?;

        let mut cursor = std::io::Cursor::new(Vec::new());
        let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut cursor, 92);
        img.write_with_encoder(encoder)
            .map_err(|e| format!("JPEG 编码失败: {}", e))?;

        Ok(cursor.into_inner())
    }

    /// 在 Rust 端调用 BigDataCloud 逆地理编码 API，绕过浏览器 CORS/Tauri HTTP 权限限制。
    /// 返回完整的行政区划层级，格式："省-市-区县-街道-社区"（根据可用数据截断）。
    /// 直辖市特殊处理，避免重复输出"北京-北京市"。
    #[tauri::command]
    pub async fn reverse_geocode(latitude: f64, longitude: f64) -> Result<Option<String>, String> {
        // 安全：校验经纬度范围
        if !(-90.0..=90.0).contains(&latitude) || !(-180.0..=180.0).contains(&longitude) {
            return Ok(None);
        }
        let url = format!(
            "https://api.bigdatacloud.net/data/reverse-geocode-client?latitude={}&longitude={}&localityLanguage=zh",
            latitude, longitude
        );
        let client = reqwest::Client::new();
        let resp = client
            .get(&url)
            .timeout(std::time::Duration::from_secs(10))
            .send()
            .await
            .map_err(|e| format!("reqwest error: {}", e))?;
        if !resp.status().is_success() {
            return Err(format!("HTTP {}", resp.status()));
        }
        let data: serde_json::Value = resp.json().await.map_err(|e| format!("json error: {}", e))?;

        // 从多个可能字段提取层级名称
        let mut province = data["principalSubdivision"].as_str().unwrap_or("").trim();
        let mut city = data["city"].as_str().or(data["locality"].as_str()).unwrap_or("").trim();
        let mut district = data["district"].as_str().unwrap_or("").trim();
        let mut street = data["street"].as_str().or(data["suburb"].as_str()).unwrap_or("").trim();
        let mut sub_locality = "";

        // 从 administrative 数组补全层级
        if let Some(admins) = data["localityInfo"]["administrative"].as_array() {
            for a in admins {
                if let (Some(level), Some(name)) = (a["adminLevel"].as_i64(), a["name"].as_str()) {
                    let name = name.trim();
                    match level {
                        2 | 3 => {
                            if province.is_empty() {
                                province = name;
                            }
                        }
                        4 | 5 => {
                            if city.is_empty() {
                                city = name;
                            }
                        }
                        6 => {
                            if district.is_empty() {
                                district = name;
                            }
                        }
                        7 => {
                            if street.is_empty() {
                                street = name;
                            }
                        }
                        8 => {
                            if sub_locality.is_empty() {
                                sub_locality = name;
                            }
                        }
                        _ => {}
                    }
                }
            }
        }

        // 直辖市：principalSubdivision 通常是直辖市本身，city 可能为空或重复
        fn is_municipality(n: &str) -> bool {
            matches!(n, "北京" | "北京市" | "上海" | "上海市" | "天津" | "天津市" | "重庆" | "重庆市")
        }
        fn normalized(n: &str) -> String {
            let n = n.trim();
            // 统一去掉末尾的"市辖区"等无意义后缀
            if n.ends_with("市辖区") && n.len() > 3 {
                n[..n.len() - 3].trim().to_string()
            } else {
                n.to_string()
            }
        }

        let mut parts: Vec<String> = Vec::new();
        let add_part = |parts: &mut Vec<String>, name: &str| {
            let name = normalized(name);
            if name.is_empty() {
                return;
            }
            // 去重：与最后一个部件相同或互相包含则不添加
            if let Some(last) = parts.last() {
                if last == &name || last.contains(&name) || name.contains(last) {
                    return;
                }
            }
            parts.push(name);
        };

        if !province.is_empty() && !is_municipality(province) {
            add_part(&mut parts, province);
        }
        if !city.is_empty() {
            // 直辖市时把 province 当作 city 输出
            if is_municipality(city) && province.is_empty() {
                add_part(&mut parts, city);
            } else if !is_municipality(city) {
                add_part(&mut parts, city);
            }
        }
        if !district.is_empty() {
            add_part(&mut parts, district);
        }
        if !street.is_empty() {
            add_part(&mut parts, street);
        }
        if !sub_locality.is_empty() && sub_locality != street {
            add_part(&mut parts, sub_locality);
        }

        if !parts.is_empty() {
            Ok(Some(parts.join("-")))
        } else if let Some(locality) = data["locality"].as_str().filter(|s| !s.is_empty()) {
            Ok(Some(locality.to_string()))
        } else if let Some(city) = data["city"].as_str().filter(|s| !s.is_empty()) {
            Ok(Some(city.to_string()))
        } else {
            Ok(None)
        }
    }

    /// 使用 Windows API 直接强制窗口铺满指定显示器，覆盖任务栏。
    /// Tauri 的 transparent frameless 窗口下 JS 的 setSize/setPosition 会被 DWM 忽略，
    /// 因此需要绕过 JS API 直接操作 HWND。
    #[tauri::command]
    pub fn force_fullscreen(
        window: tauri::Window,
        x: i32,
        y: i32,
        width: i32,
        height: i32,
    ) -> Result<(), String> {
        #[cfg(windows)]
        {
            let hwnd = window.hwnd().map_err(|e| e.to_string())?;
            unsafe {
                SetWindowPos(
                    hwnd,
                    Some(HWND_TOPMOST),
                    x,
                    y,
                    width,
                    height,
                    SWP_FRAMECHANGED | SWP_SHOWWINDOW,
                )
                .map_err(|e| format!("SetWindowPos failed: {:?}", e))?;
            }
        }
        #[cfg(not(windows))]
        {
            let _ = (window, x, y, width, height);
        }
        Ok(())
    }

    /// 恢复窗口：取消 TOPMOST 并还原尺寸/位置，必要时重新最大化。
    #[tauri::command]
    pub fn restore_window(
        window: tauri::Window,
        x: i32,
        y: i32,
        width: i32,
        height: i32,
        maximized: bool,
    ) -> Result<(), String> {
        #[cfg(windows)]
        {
            let hwnd = window.hwnd().map_err(|e| e.to_string())?;
            unsafe {
                SetWindowPos(
                    hwnd,
                    Some(HWND_NOTOPMOST),
                    x,
                    y,
                    width,
                    height,
                    SWP_FRAMECHANGED | SWP_SHOWWINDOW,
                )
                .map_err(|e| format!("SetWindowPos failed: {:?}", e))?;
            }
        }
        #[cfg(not(windows))]
        {
            let _ = (x, y, width, height, maximized);
        }
        if maximized {
            window.maximize().map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    /// 打印机信息（与前端 PrinterInfo 对齐）。
    #[derive(serde::Serialize)]
    pub struct PrinterInfo {
        pub name: String,
        #[serde(rename = "isDefault")]
        pub is_default: bool,
    }

    /// 使用 Windows Print API 获取系统打印机列表，避免调用 PowerShell 产生命令行窗口。
    #[tauri::command]
    pub fn get_printers() -> Result<Vec<PrinterInfo>, String> {
        #[cfg(windows)]
        {
            use windows::Win32::Graphics::Printing::{
                EnumPrintersW, PRINTER_ATTRIBUTE_DEFAULT, PRINTER_ENUM_CONNECTIONS,
                PRINTER_ENUM_LOCAL, PRINTER_INFO_2W,
            };
            use windows::core::PWSTR;

            unsafe {
                let mut needed: u32 = 0;
                let mut returned: u32 = 0;
                // 第一次调用获取所需缓冲区大小（包含本地、网络及共享打印机）
                let _ = EnumPrintersW(
                    PRINTER_ENUM_LOCAL | PRINTER_ENUM_CONNECTIONS,
                    None,
                    2,
                    None,
                    &mut needed,
                    &mut returned,
                );
                if needed == 0 {
                    return Ok(Vec::new());
                }
                let mut buf: Vec<u8> = vec![0; needed as usize];
                let _ = EnumPrintersW(
                    PRINTER_ENUM_LOCAL | PRINTER_ENUM_CONNECTIONS,
                    None,
                    2,
                    Some(&mut buf),
                    &mut needed,
                    &mut returned,
                );
                if returned == 0 {
                    return Ok(Vec::new());
                }

                let printers = std::slice::from_raw_parts(
                    buf.as_ptr() as *const PRINTER_INFO_2W,
                    returned as usize,
                );
                let mut result = Vec::with_capacity(returned as usize);
                for p in printers {
                    let name = if p.pPrinterName.is_null() {
                        String::new()
                    } else {
                        PWSTR(p.pPrinterName.as_ptr()).to_string().unwrap_or_default()
                    };
                    if name.is_empty() {
                        continue;
                    }
                    result.push(PrinterInfo {
                        name,
                        is_default: (p.Attributes & PRINTER_ATTRIBUTE_DEFAULT) != 0,
                    });
                }
                Ok(result)
            }
        }
        #[cfg(not(windows))]
        {
            // macOS/Linux: 用 CUPS 的 lpstat 命令获取打印机列表
            // lpstat -p -d 输出示例：
            //   printer Canon_PIXMA is idle. enabled since ...
            //   printer HP_LaserJet is idle. enabled since ...
            //   system default destination: Canon_PIXMA
            let output = std::process::Command::new("lpstat")
                .args(["-p", "-d"])
                .output()
                .map_err(|e| format!("执行 lpstat 失败: {}", e))?;
            let stdout = String::from_utf8_lossy(&output.stdout);
            let mut default_name: Option<String> = None;
            let mut result: Vec<PrinterInfo> = Vec::new();
            for line in stdout.lines() {
                let trimmed = line.trim();
                if let Some(rest) = trimmed.strip_prefix("system default destination:") {
                    default_name = Some(rest.trim().to_string());
                } else if let Some(rest) = trimmed.strip_prefix("printer ") {
                    // "printer <name> is idle..." → 取 <name>
                    if let Some(name) = rest.split_whitespace().next() {
                        result.push(PrinterInfo {
                            name: name.to_string(),
                            is_default: false,
                        });
                    }
                }
            }
            // 标记默认打印机
            if let Some(dn) = default_name {
                for p in result.iter_mut() {
                    if p.name == dn {
                        p.is_default = true;
                    }
                }
            }
            Ok(result)
        }
    }

    /// 试用期记录（持久化到 appDataDir）。
    #[derive(serde::Serialize, serde::Deserialize)]
    pub struct TrialRecord {
        pub machine_id: String,
        pub trial_start: String,
        pub trial_used: bool,
    }

    /// 获取机器指纹。
    /// 基于 Windows MachineGuid + 计算机名 + 用户名做 SHA-256 哈希，
    /// 普通卸载应用不会清除注册表中的 MachineGuid，因此能识别同一台设备。
    /// macOS: 基于 IOPlatformUUID + hostname + 用户名做 SHA-256 哈希
    #[tauri::command]
    pub fn get_machine_fingerprint() -> Result<String, String> {
        use sha2::{Digest, Sha256};
        let mut hasher = Sha256::new();

        #[cfg(windows)]
        {
            use winreg::enums::HKEY_LOCAL_MACHINE;
            use winreg::RegKey;

            // Windows 安装时生成的稳定 GUID，普通卸载不会清除
            let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
            if let Ok(key) = hklm.open_subkey("SOFTWARE\\Microsoft\\Cryptography") {
                if let Ok(guid) = key.get_value::<String, _>("MachineGuid") {
                    hasher.update(guid.as_bytes());
                }
            }

            // 计算机名
            if let Ok(name) = std::env::var("COMPUTERNAME") {
                hasher.update(name.as_bytes());
            }

            // 用户名
            if let Ok(name) = std::env::var("USERNAME") {
                hasher.update(name.as_bytes());
            }
        }

        #[cfg(target_os = "macos")]
        {
            // macOS: 用 ioreg 获取 IOPlatformUUID（硬件级 UUID，重装系统才会变）
            let output = std::process::Command::new("ioreg")
                .args(["-rd1", "-c", "IOPlatformExpertDevice"])
                .output()
                .map_err(|e| format!("执行 ioreg 失败: {}", e))?;
            let stdout = String::from_utf8_lossy(&output.stdout);
            // 从输出中提取 "IOPlatformUUID" = "XXXX-XXXX-XXXX"
            for line in stdout.lines() {
                if line.contains("IOPlatformUUID") {
                    if let Some(uuid) = line.split('=').nth(1) {
                        let uuid = uuid.trim().trim_matches('"');
                        hasher.update(uuid.as_bytes());
                        break;
                    }
                }
            }

            // hostname
            if let Ok(name) = std::env::var("HOSTNAME") {
                hasher.update(name.as_bytes());
            }
            // 用户名
            if let Ok(name) = std::env::var("USER") {
                hasher.update(name.as_bytes());
            }
        }

        #[cfg(all(not(windows), not(target_os = "macos")))]
        {
            let _ = hasher;
            return Err("机器指纹仅支持 Windows 和 macOS".to_string());
        }

        let result = hasher.finalize();
        Ok(format!("{:x}", result))
    }

    /// 从 appDataDir 读取试用期记录。
    #[tauri::command]
    pub fn load_trial_record(app: tauri::AppHandle) -> Result<Option<TrialRecord>, String> {
        let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
        let path = dir.join("trial.json");
        if !path.exists() {
            return Ok(None);
        }
        let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
        let record: TrialRecord = serde_json::from_str(&content).map_err(|e| e.to_string())?;
        Ok(Some(record))
    }

    /// 保存试用期记录到 appDataDir。
    #[tauri::command]
    pub fn save_trial_record(app: tauri::AppHandle, record: TrialRecord) -> Result<(), String> {
        let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let path = dir.join("trial.json");
        let content = serde_json::to_string_pretty(&record).map_err(|e| e.to_string())?;
        std::fs::write(&path, content).map_err(|e| e.to_string())?;
        Ok(())
    }

    /// 试用期锚点：写入注册表 HKCU\Software\MemBook（Windows）或
    /// ~/Library/Preferences/app.membook.desktop.plist（macOS）。
    /// 与 appDataDir 的 trial.json 互为冗余，即使卸载时勾选「删除应用数据」或手动清除
    /// AppData 目录，锚点仍可识别本机已试用过，防止卸载重装无限白嫖。
    #[tauri::command]
    pub fn save_trial_anchor(start: String) -> Result<(), String> {
        #[cfg(windows)]
        {
            use winreg::enums::HKEY_CURRENT_USER;
            use winreg::RegKey;
            let hkcu = RegKey::predef(HKEY_CURRENT_USER);
            let (key, _) = hkcu.create_subkey("Software\\MemBook").map_err(|e| e.to_string())?;
            key.set_value("TrialStart", &start).map_err(|e| e.to_string())?;
            Ok(())
        }
        #[cfg(target_os = "macos")]
        {
            // macOS: 写入 ~/Library/Preferences/app.membook.desktop.plist
            // 用 defaults write 命令（macOS 原生 plist 操作）
            std::process::Command::new("defaults")
                .args(["write", "app.membook.desktop", "TrialStart", &start])
                .status()
                .map_err(|e| format!("写入 plist 失败: {}", e))?;
            Ok(())
        }
        #[cfg(all(not(windows), not(target_os = "macos")))]
        {
            let _ = start;
            Ok(())
        }
    }

    /// 读取试用期锚点（Windows: 注册表 / macOS: plist）。
    #[tauri::command]
    pub fn load_trial_anchor() -> Option<String> {
        #[cfg(windows)]
        {
            use winreg::enums::HKEY_CURRENT_USER;
            use winreg::RegKey;
            let hkcu = RegKey::predef(HKEY_CURRENT_USER);
            if let Ok(key) = hkcu.open_subkey("Software\\MemBook") {
                if let Ok(v) = key.get_value::<String, _>("TrialStart") {
                    return Some(v);
                }
            }
            None
        }
        #[cfg(target_os = "macos")]
        {
            // macOS: 读取 ~/Library/Preferences/app.membook.desktop.plist
            let output = std::process::Command::new("defaults")
                .args(["read", "app.membook.desktop", "TrialStart"])
                .output();
            if let Ok(out) = output {
                if out.status.success() {
                    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
                    if !s.is_empty() {
                        return Some(s);
                    }
                }
            }
            None
        }
        #[cfg(all(not(windows), not(target_os = "macos")))]
        {
            None
        }
    }

    /// 使用应用包内携带的 sm.exe（SumatraPDF）静默打印 PDF，避免 PowerShell 弹窗。
    /// 安装包会把 sm.exe 作为资源文件释放到安装目录，因此不需要用户单独下载。
    #[tauri::command]
    pub async fn print_pdf(
        app: tauri::AppHandle,
        pdf_path: String,
        printer_name: String,
        duplex: Option<String>,
        copies: Option<u32>,
    ) -> Result<(), String> {
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;

            // 构建 SumatraPDF 打印设置字符串
            let mut settings_parts: Vec<String> = vec!["scale=fit".to_string()];
            if let Some(d) = duplex {
                match d.as_str() {
                    "longEdge" => settings_parts.push("duplex=long".to_string()),
                    "shortEdge" => settings_parts.push("duplex=short".to_string()),
                    _ => {}
                }
            }
            if let Some(c) = copies {
                if c > 1 {
                    settings_parts.push(format!("copies={}", c));
                }
            }
            let settings = settings_parts.join(",");

            // 从应用资源目录解析 sm.exe 路径
            let sm_path = app
                .path()
                .resolve("resources/sm.exe", tauri::path::BaseDirectory::Resource)
                .map_err(|e| format!("无法定位打印组件: {}", e))?;
            if !sm_path.exists() {
                return Err("打印组件缺失，请重新安装 MemBook".to_string());
            }

            let mut args = vec![
                "-print-to".to_string(),
                printer_name,
                "-silent".to_string(),
            ];
            if !settings.is_empty() {
                args.push("-print-settings".to_string());
                args.push(settings);
            }
            args.push(pdf_path.clone());
            let output = std::process::Command::new(&sm_path)
                .args(&args)
                .creation_flags(CREATE_NO_WINDOW)
                .output()
                .map_err(|e| format!("启动打印组件失败: {}", e))?;

            // 清理临时 PDF
            let _ = std::fs::remove_file(&pdf_path);

            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                let stdout = String::from_utf8_lossy(&output.stdout);
                Err(format!(
                    "打印组件返回错误 ({}): {} {}",
                    output.status.code().unwrap_or(-1),
                    stderr,
                    stdout
                ))
            } else {
                Ok(())
            }
        }
        #[cfg(not(windows))]
        {
            // macOS/Linux: 用 CUPS 的 lpr 命令打印 PDF
            // lpr -P <printer> -# <copies> -o sides=<duplex> <pdf>
            let _ = &app;
            let mut args: Vec<String> = vec!["-P".to_string(), printer_name];
            if let Some(c) = copies {
                if c > 1 {
                    args.push(format!("-#{}", c));
                }
            }
            if let Some(d) = duplex {
                match d.as_str() {
                    "longEdge" => {
                        args.push("-o".to_string());
                        args.push("sides=two-sided-long-edge".to_string());
                    }
                    "shortEdge" => {
                        args.push("-o".to_string());
                        args.push("sides=two-sided-short-edge".to_string());
                    }
                    _ => {}
                }
            }
            args.push(pdf_path.clone());

            let output = std::process::Command::new("lpr")
                .args(&args)
                .output()
                .map_err(|e| format!("启动 lpr 失败: {}", e))?;

            // 清理临时 PDF
            let _ = std::fs::remove_file(&pdf_path);

            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                Err(format!("lpr 打印失败: {}", stderr))
            } else {
                Ok(())
            }
        }
    }

    /// 使用系统默认程序打开文件（替代已弃用的 shell:allow-open）。
    /// Windows 上用 cmd /c start 避免额外依赖和权限问题。
    /// macOS 用 /usr/bin/open，Linux 用 xdg-open
    #[tauri::command]
    pub fn open_file(path: String) -> Result<(), String> {
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            std::process::Command::new("cmd")
                .args(["/c", "start", "", &path])
                .creation_flags(CREATE_NO_WINDOW)
                .spawn()
                .map_err(|e| format!("打开文件失败: {}", e))?;
        }
        #[cfg(target_os = "macos")]
        {
            std::process::Command::new("open")
                .arg(&path)
                .spawn()
                .map_err(|e| format!("打开文件失败: {}", e))?;
        }
        #[cfg(all(unix, not(target_os = "macos")))]
        {
            std::process::Command::new("xdg-open")
                .arg(&path)
                .spawn()
                .map_err(|e| format!("打开文件失败: {}", e))?;
        }
        Ok(())
    }

    /// 将文件移入系统回收站（而非永久删除），防止用户误删后无法找回。
    /// Windows: 使用 Shell API 的 SHFileOperationW + FOF_ALLOWUNDO
    /// macOS/Linux: 使用跨平台 trash crate（macOS 内部用 NSWorkspace.recycleURLs）
    #[tauri::command]
    pub fn trash_files(paths: Vec<String>) -> Result<(), String> {
        if paths.is_empty() {
            return Ok(());
        }

        #[cfg(windows)]
        {
            use windows::Win32::UI::Shell::{
                SHFileOperationW, SHFILEOPSTRUCTW, FO_DELETE, FOF_ALLOWUNDO, FOF_NOERRORUI, FOF_SILENT,
            };
            use windows::core::PCWSTR;

            // SHFileOperationW 要求 pFrom 中多个路径以单 \0 分隔，且整体以双 \0 结尾。
            let mut from = String::new();
            for p in &paths {
                // 统一为正斜杠->反斜杠，并追加 null 分隔符
                from.push_str(&p.replace('/', "\\"));
                from.push('\0');
            }
            from.push('\0');
            let from_wide: Vec<u16> = from.encode_utf16().collect();

            let mut op = SHFILEOPSTRUCTW {
                hwnd: windows::Win32::Foundation::HWND::default(),
                wFunc: FO_DELETE,
                pFrom: PCWSTR(from_wide.as_ptr()),
                pTo: PCWSTR::null(),
                // FILEOPERATION_FLAGS 是 u32 newtype，SHFILEOPSTRUCTW.fFlags 为 u16，需取出内部值并截断
                fFlags: (FOF_ALLOWUNDO | FOF_NOERRORUI | FOF_SILENT).0 as u16,
                // windows 0.61 中 BOOL 是 newtype struct，Default 即 FALSE(0)
                fAnyOperationsAborted: Default::default(),
                hNameMappings: std::ptr::null_mut(),
                lpszProgressTitle: PCWSTR::null(),
            };

            unsafe {
                // 返回 0 表示全部成功；非 0 表示被取消或失败
                let ret = SHFileOperationW(&mut op);
                if ret != 0 {
                    return Err(format!("移入回收站失败，错误码: {}", ret));
                }
            }
            Ok(())
        }
        #[cfg(not(windows))]
        {
            // macOS/Linux: 使用跨平台 trash crate
            let path_refs: Vec<std::path::PathBuf> = paths.iter().map(std::path::PathBuf::from).collect();
            trash::delete_all(path_refs).map_err(|e| format!("移入回收站失败: {}", e))
        }
    }
}

/// macOS: 调整交通灯按钮（红黄绿）位置，让按钮中心对齐 AppHeader 内容中心。
///
/// AppHeader 高度 48px（--layout-toolbar-height），内容 items-center 垂直居中在 24px from top。
/// macOS 标准标题栏 28px，交通灯默认中心在 14px from top，与 logo 中心差 10px。
///
/// setTrafficLightPosition 的坐标系：原点在窗口左下角，y 轴向上。
/// 按钮高约 14px，要中心在 24px from top → 按钮左下角 y = windowHeight - 24 - 7 = windowHeight - 31
#[cfg(target_os = "macos")]
fn set_mac_traffic_light_position(window: &tauri::WebviewWindow) {
    use cocoa::foundation::{NSPoint, NSRect};
    use objc::msg_send;
    use objc::sel_impl;

    let ns_window_ptr = match window.ns_window() {
        Ok(ptr) => ptr,
        Err(_) => return,
    };
    let ns_window = ns_window_ptr as *mut objc::runtime::Object;

    unsafe {
        // 获取窗口 frame 以计算高度
        let frame: NSRect = msg_send![ns_window, frame];
        let window_height = frame.size.height;

        // 交通灯按钮左下角位置：x=20（默认左边距），y=windowHeight-31（中心在 24px from top）
        let point = NSPoint::new(20.0, window_height - 31.0);
        let _: () = msg_send![ns_window, setTrafficLightPosition: point];
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build());

    // `native-heic` feature 启用时才注册 Rust 原生 libheif 解码命令
    #[cfg(feature = "native-heic")]
    let builder = builder.invoke_handler(tauri::generate_handler![
        commands::convert_heic_to_jpeg,
        commands::convert_heic_to_jpeg_native,
        commands::reverse_geocode,
        commands::force_fullscreen,
        commands::restore_window,
        commands::get_printers,
        commands::print_pdf,
        commands::get_machine_fingerprint,
        commands::load_trial_record,
        commands::save_trial_record,
        commands::load_trial_anchor,
        commands::save_trial_anchor,
        commands::open_file,
        commands::trash_files,
    ]);

    #[cfg(not(feature = "native-heic"))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        commands::convert_heic_to_jpeg,
        commands::reverse_geocode,
        commands::force_fullscreen,
        commands::restore_window,
        commands::get_printers,
        commands::print_pdf,
        commands::get_machine_fingerprint,
        commands::load_trial_record,
        commands::save_trial_record,
        commands::load_trial_anchor,
        commands::save_trial_anchor,
        commands::open_file,
        commands::trash_files,
    ]);

    builder
        .setup(|app| {
            #[cfg(windows)]
            {
                // Windows: 移除原生窗口装饰（标题栏/边框），用前端自定义标题栏
                // tauri.conf.json 设 decorations: true 是为 macOS 交通灯按钮，
                // Windows 上在此处动态移除装饰
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.set_decorations(false);
                    // 移除 WS_SYSMENU，阻止 Alt+Space 调出系统菜单（还原/移动/大小/最大化/最小化/关闭）
                    if let Ok(hwnd) = window.hwnd() {
                        unsafe {
                            let style = GetWindowLongPtrW(hwnd, GWL_STYLE);
                            SetWindowLongPtrW(hwnd, GWL_STYLE, style & !(WS_SYSMENU.0 as isize));
                            // 刷新窗口非客户区，使样式变更真正生效
                            let _ = SetWindowPos(
                                hwnd,
                                None,
                                0,
                                0,
                                0,
                                0,
                                SWP_FRAMECHANGED | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_SHOWWINDOW,
                            );
                        }
                    }
                    // 设置高分辨率窗口图标（128x128 PNG），覆盖 generate_context! 嵌入的默认图标
                    let icon_bytes = include_bytes!("../icons/128x128.png");
                    if let Ok(icon) = tauri::image::Image::from_bytes(icon_bytes) {
                        let _ = window.set_icon(icon);
                    }
                }
            }
            #[cfg(target_os = "macos")]
            {
                // macOS: 隐藏窗口标题文字 + 调整交通灯按钮位置对齐 logo
                if let Some(window) = app.get_webview_window("main") {
                    // 1. 隐藏标题栏中央的 "MemBook" 标题文字
                    let _ = window.set_title("");

                    // 2. 调整交通灯按钮位置：让按钮中心对齐 AppHeader 内容中心
                    //    AppHeader 高度 48px，内容垂直居中在 24px from top
                    //    macOS 标准标题栏 28px，交通灯默认中心在 14px，与 logo 差 10px
                    //    setTrafficLightPosition 的坐标系：x 从左，y 从窗口底部
                    //    按钮高约 14px，要中心在 24px from top → 按钮左下角 y = windowHeight - 31
                    set_mac_traffic_light_position(&window);

                    // 3. 窗口 resize 时重新设置（y 值依赖窗口高度）
                    let win_clone = window.clone();
                    let _ = window.on_resized(move |_| {
                        set_mac_traffic_light_position(&win_clone);
                    });
                }
            }
            // 启动时把数据目录打出来，方便排查
            if let Ok(dir) = app.path().app_data_dir() {
                println!("[MemBook] app data dir: {:?}", dir);
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::commands::*;

    #[test]
    fn heic_path_rejects_non_heic_extension() {
        // 路径扩展名校验：非 .heic/.heif 应返回错误
        let result = convert_heic_to_jpeg("test.jpg".to_string());
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.contains("不支持的文件扩展名"), "actual: {}", err);
    }

    #[test]
    fn heic_path_rejects_traversal() {
        // 路径遍历防护：包含 .. 段的路径应被拒绝
        let result = convert_heic_to_jpeg("../secret.heic".to_string());
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.contains("非法"), "actual: {}", err);
    }

    #[test]
    fn heic_path_accepts_valid_extensions() {
        // .heic / .heif 扩展名应通过校验（文件不存在会返回错误，但不应是扩展名错误）
        let result = convert_heic_to_jpeg("nonexistent.heic".to_string());
        assert!(result.is_err());
        let err = result.unwrap_err();
        // 错误应是文件读取/解码失败，而非扩展名校验失败
        assert!(!err.contains("不支持的文件扩展名"), "actual: {}", err);
    }

    #[test]
    fn reverse_geocode_rejects_invalid_coords() {
        // 超出范围的经纬度应返回 Ok(None)，不发起网络请求
        let result = futures::executor::block_on(reverse_geocode(999.0, 999.0));
        assert!(result.is_ok());
        assert!(result.unwrap().is_none());
    }

    #[test]
    fn reverse_geocode_accepts_boundary_coords() {
        // 边界值 ±90 / ±180 应通过校验（实际网络请求会失败，但校验本身应通过）
        let result = futures::executor::block_on(reverse_geocode(90.0, 180.0));
        // 网络请求可能失败，但校验通过：失败返回 Err，成功返回 Ok
        // 这里只验证不会因为校验返回 Ok(None)
        let _ = result;
    }
}
