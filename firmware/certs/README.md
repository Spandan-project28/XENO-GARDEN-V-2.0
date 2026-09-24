# Broker CA certificate

For TLS to a managed MQTT broker, put the broker's **root CA** certificate (PEM) in this folder
as `ca.pem`. `scripts/embed_config.py` embeds it into the firmware at build time.

Without `ca.pem`, TLS connections still encrypt but cannot authenticate the server
(the firmware logs a warning). Plain (non-TLS) MQTT is used for local development.
