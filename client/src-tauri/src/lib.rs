mod commands;

#[cfg(windows)]
use windows_core::Interface;

pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|_app| {
            // Accept self-signed TLS certificates so the desktop app can
            // connect to Haven servers that use auto-generated certs.

            #[cfg(windows)]
            {
                use tauri::Manager;
                let webview = _app
                    .get_webview_window("main")
                    .expect("main window not found");
                webview
                    .with_webview(|platform_webview| {
                        use webview2_com::Microsoft::Web::WebView2::Win32::*;
                        use webview2_com::ServerCertificateErrorDetectedEventHandler;

                        unsafe {
                            let core: ICoreWebView2 = platform_webview
                                .controller()
                                .CoreWebView2()
                                .expect("failed to get CoreWebView2");
                            let core14: ICoreWebView2_14 = core
                                .cast()
                                .expect("WebView2 runtime too old for certificate handling");

                            let mut token: i64 = 0;
                            core14
                                .add_ServerCertificateErrorDetected(
                                    &ServerCertificateErrorDetectedEventHandler::create(Box::new(
                                        |_, args| {
                                            if let Some(args) = args {
                                                args.SetAction(
                                            COREWEBVIEW2_SERVER_CERTIFICATE_ERROR_ACTION_ALWAYS_ALLOW,
                                        )?;
                                            }
                                            Ok(())
                                        },
                                    )),
                                    &mut token,
                                )
                                .expect("failed to register certificate handler");
                        }
                    })
                    .expect("with_webview failed");
            }

            #[cfg(target_os = "linux")]
            {
                use tauri::Manager;
                let webview = _app
                    .get_webview_window("main")
                    .expect("main window not found");
                webview
                    .with_webview(|platform_webview| {
                        use webkit2gtk::{TLSErrorsPolicy, WebContextExt, WebViewExt};
                        let wk_webview = platform_webview.inner().clone();
                        if let Some(context) = wk_webview.web_context() {
                            context.set_tls_errors_policy(TLSErrorsPolicy::Ignore);
                        }
                    })
                    .expect("with_webview failed");
            }

            // macOS: WKWebView does not expose a simple API to ignore TLS
            // certificate errors. Users must trust self-signed certs in
            // System Keychain, or use properly signed certificates.

            Ok(())
        });

    let builder = builder.invoke_handler(tauri::generate_handler![commands::get_app_version,]);

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
