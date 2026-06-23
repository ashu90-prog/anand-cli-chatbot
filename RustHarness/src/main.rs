use std::process::{Command, Stdio};
use std::io::{BufRead, BufReader, Write};
use std::sync::mpsc::{channel, Receiver};
use std::sync::{Arc, Mutex, atomic::{AtomicBool, Ordering}};
use std::thread;
use std::collections::HashSet;
use std::fs;
use serde::{Serialize, Deserialize};

#[derive(Serialize, Deserialize, Debug)]
struct HarnessRequest {
    id: String,
    action: String,
    command: Option<String>,
    path: Option<String>,
    content: Option<String>,
}

#[derive(Serialize, Deserialize, Debug)]
struct HarnessResponse {
    id: String,
    status: String,
    output: Option<String>,
    error: Option<String>,
}

struct Whitelist {
    allowed_commands: HashSet<String>,
}

impl Whitelist {
    fn new() -> Self {
        Self {
            allowed_commands: HashSet::new(),
        }
    }
    fn is_allowed(&self, cmd: &str) -> bool {
        self.allowed_commands.contains(cmd)
    }
    fn allow(&mut self, cmd: String) {
        self.allowed_commands.insert(cmd);
    }
}

fn execute_request(req: &HarnessRequest) -> Result<String, String> {
    match req.action.as_str() {
        "run_command" => {
            let cmd_str = req.command.as_ref().ok_or("No command provided")?;
            let output = if cfg!(target_os = "windows") {
                Command::new("powershell")
                    .args(&["-Command", cmd_str])
                    .output()
            } else {
                Command::new("sh")
                    .args(&["-c", cmd_str])
                    .output()
            };

            match output {
                Ok(out) => {
                    let stdout_str = String::from_utf8_lossy(&out.stdout).to_string();
                    let stderr_str = String::from_utf8_lossy(&out.stderr).to_string();
                    if out.status.success() {
                        Ok(stdout_str)
                    } else {
                        Err(format!("Command failed: {}\n{}", stdout_str, stderr_str))
                    }
                }
                Err(e) => Err(format!("Failed to execute command: {}", e)),
            }
        }
        "read_file" => {
            let file_path = req.path.as_ref().ok_or("No path provided")?;
            fs::read_to_string(file_path).map_err(|e| format!("Failed to read file: {}", e))
        }
        "write_file" => {
            let file_path = req.path.as_ref().ok_or("No path provided")?;
            let content = req.content.as_ref().ok_or("No content provided")?;
            
            // Create parent directories if they don't exist
            if let Some(parent) = std::path::Path::new(file_path).parent() {
                let _ = fs::create_dir_all(parent);
            }
            
            fs::write(file_path, content)
                .map(|_| "File written successfully".to_string())
                .map_err(|e| format!("Failed to write file: {}", e))
        }
        _ => Err(format!("Unknown harness action: {}", req.action)),
    }
}

fn prompt_user(req: &HarnessRequest, stdin_rx: &Receiver<String>) -> String {
    println!("\n\x1b[33m⚠️  A.N.A.N.D Capability Request:\x1b[0m");
    match req.action.as_str() {
        "run_command" => {
            println!("   Action:  \x1b[36mRun Shell Command\x1b[0m");
            println!("   Command: \x1b[1;37m{}\x1b[0m", req.command.as_ref().unwrap_or(&"".to_string()));
        }
        "read_file" => {
            println!("   Action:  \x1b[36mRead File\x1b[0m");
            println!("   Path:    \x1b[1;37m{}\x1b[0m", req.path.as_ref().unwrap_or(&"".to_string()));
        }
        "write_file" => {
            println!("   Action:  \x1b[36mWrite File\x1b[0m");
            println!("   Path:    \x1b[1;37m{}\x1b[0m", req.path.as_ref().unwrap_or(&"".to_string()));
        }
        _ => {
            println!("   Action:  \x1b[36mUnknown\x1b[0m");
        }
    }
    println!("\n   Options: [\x1b[32m1\x1b[0m] Allow once | [\x1b[32m2\x1b[0m] Always allow | [\x1b[31m3\x1b[0m] Reject");
    print!("   Select choice (1-3): ");
    let _ = std::io::stdout().flush();
    
    loop {
        if let Ok(line) = stdin_rx.recv() {
            let choice = line.trim();
            if choice == "1" || choice == "2" || choice == "3" {
                return choice.to_string();
            }
            print!("   Invalid choice. Select 1-3: ");
            let _ = std::io::stdout().flush();
        }
    }
}

fn main() {
    // Spawn Node.js chatbot as child process
    let mut child = Command::new("node")
        .arg("../NodeJS/main.js")
        .env("ANAND_HARNESS", "true")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .expect("Failed to start Node.js chatbot. Make sure node is on your PATH.");

    let child_stdin = child.stdin.take().expect("Failed to open child stdin");
    let child_stdout = child.stdout.take().expect("Failed to open child stdout");

    // Channels for routing user stdin to the child stdin or prompt handler
    let (stdin_tx, stdin_rx) = channel::<String>();
    let (prompt_tx, prompt_rx) = channel::<String>();
    
    // Channel for writing to the child's stdin
    let (child_stdin_tx, child_stdin_rx) = channel::<String>();

    // Shared state to route terminal stdin
    let is_prompting = Arc::new(AtomicBool::new(false));
    let is_prompting_stdin = Arc::clone(&is_prompting);

    // Stdin reading thread: reads from terminal stdin once
    thread::spawn(move || {
        let stdin = std::io::stdin();
        let mut buffer = String::new();
        loop {
            buffer.clear();
            if stdin.read_line(&mut buffer).is_ok() {
                if is_prompting_stdin.load(Ordering::SeqCst) {
                    if prompt_tx.send(buffer.clone()).is_err() {
                        break;
                    }
                } else {
                    if stdin_tx.send(buffer.clone()).is_err() {
                        break;
                    }
                }
            } else {
                break;
            }
        }
    });

    // Stdin forwarding thread: forwards normal terminal stdin to the child_stdin channel
    let stdin_rx_mutex = Arc::new(Mutex::new(stdin_rx));
    let stdin_rx_clone = Arc::clone(&stdin_rx_mutex);
    let child_stdin_tx_clone = child_stdin_tx.clone();
    thread::spawn(move || {
        loop {
            let line = {
                let rx = stdin_rx_clone.lock().unwrap();
                rx.recv()
            };
            if let Ok(content) = line {
                if child_stdin_tx_clone.send(content).is_err() {
                    break;
                }
            } else {
                break;
            }
        }
    });

    // Dedicated writer thread for the child process stdin
    thread::spawn(move || {
        let mut stdin = child_stdin;
        while let Ok(line) = child_stdin_rx.recv() {
            if stdin.write_all(line.as_bytes()).is_err() {
                break;
            }
            let _ = stdin.flush();
        }
    });

    // Whitelist state for "always allow" commands
    let whitelist = Arc::new(Mutex::new(Whitelist::new()));

    // Child output reading thread (main coordinator)
    let stdout_reader = BufReader::new(child_stdout);
    let whitelist_clone = Arc::clone(&whitelist);
    let is_prompting_clone = Arc::clone(&is_prompting);
    let child_stdin_tx_harness = child_stdin_tx.clone();

    thread::spawn(move || {
        for line_res in stdout_reader.lines() {
            if let Ok(line) = line_res {
                if line.starts_with("__HARNESS_REQ__ ") {
                    let req_json = line.trim_start_matches("__HARNESS_REQ__ ");
                    if let Ok(req) = serde_json::from_str::<HarnessRequest>(req_json) {
                        // Check whitelist
                        let is_allowed = {
                            if req.action == "run_command" {
                                if let Some(cmd) = &req.command {
                                    let wl = whitelist_clone.lock().unwrap();
                                    wl.is_allowed(cmd)
                                } else {
                                    false
                                }
                            } else {
                                false
                            }
                        };

                        if is_allowed {
                            // Automatically execute
                            let res = match execute_request(&req) {
                                Ok(out) => HarnessResponse {
                                    id: req.id,
                                    status: "success".to_string(),
                                    output: Some(out),
                                    error: None,
                                },
                                Err(err) => HarnessResponse {
                                    id: req.id,
                                    status: "error".to_string(),
                                    output: None,
                                    error: Some(err),
                                },
                            };
                            let res_json = serde_json::to_string(&res).unwrap();
                            let _ = child_stdin_tx_harness.send(format!("__HARNESS_RES__ {}\n", res_json));
                        } else {
                            // Ask user
                            is_prompting_clone.store(true, Ordering::SeqCst);
                            let choice = prompt_user(&req, &prompt_rx);
                            is_prompting_clone.store(false, Ordering::SeqCst);

                            if choice == "1" || choice == "2" {
                                if choice == "2" {
                                    // Add to whitelist
                                    if req.action == "run_command" {
                                        if let Some(cmd) = &req.command {
                                            let mut wl = whitelist_clone.lock().unwrap();
                                            wl.allow(cmd.clone());
                                        }
                                    }
                                }

                                let res = match execute_request(&req) {
                                    Ok(out) => HarnessResponse {
                                        id: req.id,
                                        status: "success".to_string(),
                                        output: Some(out),
                                        error: None,
                                    },
                                    Err(err) => HarnessResponse {
                                        id: req.id,
                                        status: "error".to_string(),
                                        output: None,
                                        error: Some(err),
                                    },
                                };
                                let res_json = serde_json::to_string(&res).unwrap();
                                let _ = child_stdin_tx_harness.send(format!("__HARNESS_RES__ {}\n", res_json));
                            } else {
                                // Rejected
                                let res = HarnessResponse {
                                    id: req.id,
                                    status: "error".to_string(),
                                    output: None,
                                    error: Some("Permission Denied by user".to_string()),
                                };
                                let res_json = serde_json::to_string(&res).unwrap();
                                let _ = child_stdin_tx_harness.send(format!("__HARNESS_RES__ {}\n", res_json));
                            }
                        }
                    }
                } else {
                    println!("{}", line);
                }
            } else {
                break;
            }
        }
    });

    // Wait for the child process to terminate
    let status = child.wait().expect("Child process wasn't running");
    std::process::exit(status.code().unwrap_or(0));
}
