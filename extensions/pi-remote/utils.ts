import { networkInterfaces } from "node:os";
import { createServer } from "node:net";
import { randomInt } from "node:crypto";

/**
 * Finds the local LAN IP address from network interfaces.
 * Prefers IPv4 interfaces that are not internal (loopback).
 * Looks for common interface names like en0, wlan0 first.
 * Falls back to 127.0.0.1 if no suitable interface is found.
 */
export function getLocalIP(): string {
	const interfaces = networkInterfaces();
	const preferredNames = ["en0", "wlan0", "eth0", "wl0"];

	// First pass: check preferred interface names
	for (const name of preferredNames) {
		const iface = interfaces[name];
		if (iface) {
			for (const info of iface) {
				if (info.family === "IPv4" && !info.internal) {
					return info.address;
				}
			}
		}
	}

	// Second pass: any non-internal IPv4 address
	for (const _name in interfaces) {
		const iface = interfaces[_name];
		if (iface) {
			for (const info of iface) {
				if (info.family === "IPv4" && !info.internal) {
					return info.address;
				}
			}
		}
	}

	// Fallback to localhost
	return "127.0.0.1";
}

/**
 * Finds an available port starting from the given port.
 * Tests each port by attempting to listen on 0.0.0.0.
 * Returns the first port that succeeds in binding.
 */
export function findAvailablePort(startPort: number): Promise<number> {
	return new Promise((resolve, reject) => {
		const tryPort = (port: number): void => {
			const server = createServer();

			server.on("error", () => {
				// Port is in use, try the next one
				tryPort(port + 1);
			});

			server.listen(port, "0.0.0.0", () => {
				const address = server.address();
				const boundPort = typeof address === "object" ? address?.port : port;
				server.close(() => {
					resolve(boundPort);
				});
			});
		};

		tryPort(startPort);
	});
}

/**
 * Generates a random 6-digit PIN using cryptographically secure random numbers.
 * Pads with leading zeros if the random number is less than 100000.
 */
export function generatePin(): string {
	const pin = randomInt(0, 1000000);
	return pin.toString().padStart(6, "0");
}
