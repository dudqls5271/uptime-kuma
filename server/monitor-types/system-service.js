const { MonitorType } = require("./monitor-type");
const { execFile } = require("child_process");
const process = require("process");
const { UP } = require("../../src/util");

const SSH_OUTPUT_MAX_CHARS = 200;

function trimOutput(output) {
    let text = (output || "").toString().trim();
    if (text.length > SSH_OUTPUT_MAX_CHARS) {
        text = text.substring(0, SSH_OUTPUT_MAX_CHARS) + "...";
    }
    return text;
}

function escapeSshArg(arg) {
    if (arg === "") {
        return "''";
    }
    return `'${String(arg).replace(/'/g, `'\"'\"'`)}'`;
}

function parseSshUrl(sshUrl) {
    if (typeof sshUrl !== "string") {
        throw new Error("Invalid SSH URL.");
    }

    let url;
    try {
        url = new URL(sshUrl);
    } catch (e) {
        throw new Error("Invalid SSH URL.");
    }

    if (url.protocol !== "ssh:") {
        throw new Error("SSH URL must start with ssh://");
    }

    if (!url.hostname) {
        throw new Error("SSH URL requires a hostname.");
    }

    let userHost = url.hostname;
    if (url.username) {
        userHost = `${decodeURIComponent(url.username)}@${url.hostname}`;
    }

    return {
        userHost,
        port: url.port || null,
    };
}

async function execSshCommand(sshUrl, remoteArgs, timeoutMs = 5000) {
    const parsed = parseSshUrl(sshUrl);
    const sshArgs = [
        "-o",
        "BatchMode=yes",
        "-o",
        "ConnectTimeout=5",
    ];

    if (parsed.port) {
        sshArgs.push("-p", parsed.port);
    }

    sshArgs.push(parsed.userHost, remoteArgs.map(escapeSshArg).join(" "));

    return await new Promise((resolve, reject) => {
        execFile("ssh", sshArgs, { timeout: timeoutMs }, (error, stdout, stderr) => {
            if (error) {
                const output = trimOutput(stderr || stdout || error.message);
                reject(new Error(output || "Failed to execute command over SSH"));
                return;
            }

            resolve((stdout || "").toString());
        });
    });
}

class SystemServiceMonitorType extends MonitorType {
    name = "system-service";
    description = "Checks if a system service is running (systemd on Linux, Service Manager on Windows).";

    /**
     * Check the system service status.
     * Detects OS and dispatches to the appropriate check method.
     * @param {object} monitor The monitor object containing monitor.system_service_name.
     * @param {object} heartbeat The heartbeat object to update.
     * @returns {Promise<void>} Resolves when check is complete.
     */
    async check(monitor, heartbeat) {
        if (!monitor.system_service_name) {
            throw new Error("Service Name is required.");
        }

        const checkMethod = monitor.system_service_check_method || "local";

        if (checkMethod === "ssh") {
            return this.checkViaSSH(monitor, heartbeat);
        }

        if (process.platform === "win32") {
            return this.checkWindows(monitor.system_service_name, heartbeat);
        } else if (process.platform === "linux") {
            return this.checkLinux(monitor.system_service_name, heartbeat);
        } else {
            throw new Error(`System Service monitoring is not supported on ${process.platform}`);
        }
    }

    /**
     * Linux Check (Systemd)
     * @param {string} serviceName The name of the service to check.
     * @param {object} heartbeat The heartbeat object.
     * @returns {Promise<void>}
     */
    async checkLinux(serviceName, heartbeat) {
        return new Promise((resolve, reject) => {
            // SECURITY: Prevent Argument Injection
            // Only allow alphanumeric, dots, dashes, underscores, and @
            if (!serviceName || !/^[a-zA-Z0-9._\-@]+$/.test(serviceName)) {
                reject(new Error("Invalid service name. Please use the internal Service Name (no spaces)."));
                return;
            }

            execFile("systemctl", ["is-active", serviceName], { timeout: 5000 }, (error, stdout, stderr) => {
                // Combine output and truncate to ~200 chars to prevent DB bloat
                let output = (stderr || stdout || "").toString().trim();
                if (output.length > 200) {
                    output = output.substring(0, 200) + "...";
                }

                if (error) {
                    reject(new Error(output || `Service '${serviceName}' is not running.`));
                    return;
                }

                heartbeat.status = UP;
                heartbeat.msg = `Service '${serviceName}' is running.`;
                resolve();
            });
        });
    }

    /**
     * SSH Check (remote system service)
     * @param {object} monitor Monitor data (service name + ssh settings).
     * @param {object} heartbeat The heartbeat object.
     * @returns {Promise<void>}
     */
    async checkViaSSH(monitor, heartbeat) {
        const sshUrl = monitor.system_service_ssh_url;
        if (!sshUrl) {
            throw new Error("SSH Target is required.");
        }

        const platform = monitor.system_service_ssh_platform || "linux";
        if (platform === "win32") {
            return this.checkWindowsViaSSH(monitor.system_service_name, sshUrl, heartbeat);
        }

        if (platform === "linux") {
            return this.checkLinuxViaSSH(monitor.system_service_name, sshUrl, heartbeat);
        }

        throw new Error(`System Service SSH monitoring is not supported on ${platform}`);
    }

    /**
     * Linux Check via SSH (Systemd)
     * @param {string} serviceName The name of the service to check.
     * @param {string} sshUrl SSH target URL.
     * @param {object} heartbeat The heartbeat object.
     * @returns {Promise<void>}
     */
    async checkLinuxViaSSH(serviceName, sshUrl, heartbeat) {
        // SECURITY: Prevent Argument Injection
        if (!serviceName || !/^[a-zA-Z0-9._\-@]+$/.test(serviceName)) {
            throw new Error("Invalid service name. Please use the internal Service Name (no spaces).");
        }

        let output = "";
        try {
            output = await execSshCommand(sshUrl, ["systemctl", "is-active", serviceName], 5000);
        } catch (e) {
            const message = trimOutput(e.message || "");
            throw new Error(`Service '${serviceName}' is ${message || "not running"}.`);
        }

        const status = trimOutput(output);
        if (status !== "active") {
            throw new Error(`Service '${serviceName}' is ${status || "not running"}.`);
        }

        heartbeat.status = UP;
        heartbeat.msg = `Service '${serviceName}' is running.`;
    }

    /**
     * Windows Check via SSH (PowerShell)
     * @param {string} serviceName The name of the service to check.
     * @param {string} sshUrl SSH target URL.
     * @param {object} heartbeat The heartbeat object.
     * @returns {Promise<void>}
     */
    async checkWindowsViaSSH(serviceName, sshUrl, heartbeat) {
        if (!/^[A-Za-z0-9._-]+$/.test(serviceName)) {
            throw new Error("Invalid service name. Only alphanumeric characters and '.', '_', '-' are allowed.");
        }

        const command = "(Get-Service -Name '" + serviceName.replaceAll("'", "''") + "').Status";

        let output = "";
        try {
            output = await execSshCommand(sshUrl, ["powershell", "-NoProfile", "-NonInteractive", "-Command", command], 5000);
        } catch (e) {
            throw new Error(`Service '${serviceName}' is not running/found.`);
        }

        const status = trimOutput(output);
        if (status === "Running") {
            heartbeat.status = UP;
            heartbeat.msg = `Service '${serviceName}' is running.`;
            return;
        }

        throw new Error(`Service '${serviceName}' is ${status || "not running"}.`);
    }

    /**
     * Windows Check (PowerShell)
     * @param {string} serviceName The name of the service to check.
     * @param {object} heartbeat The heartbeat object.
     * @returns {Promise<void>} Resolves on success, rejects on error.
     */
    async checkWindows(serviceName, heartbeat) {
        return new Promise((resolve, reject) => {
            // SECURITY: Validate service name to reduce command-injection risk
            if (!/^[A-Za-z0-9._-]+$/.test(serviceName)) {
                throw new Error("Invalid service name. Only alphanumeric characters and '.', '_', '-' are allowed.");
            }

            const cmd = "powershell";
            const args = [
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                // Single quotes around the service name
                `(Get-Service -Name '${serviceName.replaceAll("'", "''")}').Status`,
            ];

            execFile(cmd, args, { timeout: 5000 }, (error, stdout, stderr) => {
                let output = (stderr || stdout || "").toString().trim();
                if (output.length > 200) {
                    output = output.substring(0, 200) + "...";
                }

                if (error || stderr) {
                    reject(new Error(`Service '${serviceName}' is not running/found.`));
                    return;
                }

                if (output === "Running") {
                    heartbeat.status = UP;
                    heartbeat.msg = `Service '${serviceName}' is running.`;
                    resolve();
                } else {
                    reject(new Error(`Service '${serviceName}' is ${output}.`));
                }
            });
        });
    }
}

module.exports = {
    SystemServiceMonitorType,
};
