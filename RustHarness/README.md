# A.N.A.N.D Capability Harness (Rust)

A high-performance security supervisor written in Rust that wraps the A.N.A.N.D Node.js chatbot, allowing it to perform read/write files and run shell commands only when explicitly approved by the user.

## Security Controls
*   **Prompted Approvals**: Every privileged request requires authorization (Allow Once, Always Allow, or Reject).
*   **Command Whitelisting**: Selecting "Always Allow" adds that command to an in-memory whitelist, allowing subsequent invocations of that exact command to run seamlessly.
*   **Decoupled Permissions**: Node.js chatbot runs inside a sandboxed environment without direct command execution privileges.

## Compilation and Launch

1.  **Build the Harness**
    ```bash
    cargo build --release
    ```

2.  **Launch the Chatbot via Harness**
    ```bash
    # On Windows:
    .\target\release\anand-harness.exe
    # On macOS/Linux:
    ./target/release/anand-harness
    ```

## Slash Commands Supported (Inside Chat)
*   `/run <command>` - Request shell command execution.
*   `/read <file_path>` - Request local file reading.
*   `/write <file_path> <content>` - Request local file writing.
