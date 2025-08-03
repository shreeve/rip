# 🔒 Using Production SSL Certificates

> **Note**: With rip-server v3.0+, you can provide certificates in any order:
> ```bash
> rip-server cert.pem key.pem prod    # Any order!
> rip-server prod 3443 key.pem cert.pem w:10
> rip-server /etc/ssl/cert.pem /etc/ssl/key.pem
> ```

**Drop in your own SSL certificates for production use**

The Rip Application Server fully supports existing SSL certificates from trusted Certificate Authorities (CAs) like Let's Encrypt, DigiCert, Comodo, etc.

## 🚀 Quick Start with Existing Certificates

### Method 1: Direct Command Line
```bash
# Using your existing certificates
./start.sh prod false /path/to/app 3443 /path/to/your/cert.pem /path/to/your/key.pem

# Example with Let's Encrypt certificates
./start.sh prod false /path/to/app 3443 /etc/letsencrypt/live/yourdomain.com/fullchain.pem /etc/letsencrypt/live/yourdomain.com/privkey.pem
```

### Method 2: Update package.json Scripts
```json
{
  "scripts": {
    "start:prod": "cd /Users/shreeve/Data/Code/rip/server && ./start.sh prod false /path/to/app 3443 /etc/ssl/certs/yourdomain.com.pem /etc/ssl/private/yourdomain.com.key",
    "start:prod:fg": "cd /Users/shreeve/Data/Code/rip/server && ./start.sh prod true /path/to/app 3443 /etc/ssl/certs/yourdomain.com.pem /etc/ssl/private/yourdomain.com.key"
  }
}
```

### Method 3: Environment Variables (Recommended for Production)
```bash
# Set environment variables
export SSL_CERT_PATH="/etc/letsencrypt/live/yourdomain.com/fullchain.pem"
export SSL_KEY_PATH="/etc/letsencrypt/live/yourdomain.com/privkey.pem"
export APP_PATH="/path/to/your/app"

# Start with environment variables
./start.sh prod false "$APP_PATH" 3443 "$SSL_CERT_PATH" "$SSL_KEY_PATH"
```

## 📋 Common Certificate Locations

### Let's Encrypt (Certbot)
```bash
# Certificates are typically in:
CERT_PATH="/etc/letsencrypt/live/yourdomain.com/fullchain.pem"
KEY_PATH="/etc/letsencrypt/live/yourdomain.com/privkey.pem"

# Usage:
./start.sh prod false /app 3443 "$CERT_PATH" "$KEY_PATH"
```

### Custom SSL Directory
```bash
# If you store certificates in a custom location:
CERT_PATH="/opt/ssl/yourdomain.com/certificate.pem"
KEY_PATH="/opt/ssl/yourdomain.com/private.key"

# Usage:
./start.sh prod false /app 3443 "$CERT_PATH" "$KEY_PATH"
```

### Cloud Provider Certificates
```bash
# AWS Certificate Manager exported certificates:
CERT_PATH="/opt/aws-certs/certificate.pem"
KEY_PATH="/opt/aws-certs/private.key"

# Google Cloud SSL certificates:
CERT_PATH="/opt/gcp-certs/yourdomain.crt"
KEY_PATH="/opt/gcp-certs/yourdomain.key"
```

## 🔧 Docker/Container Usage

### Dockerfile Example
```dockerfile
FROM oven/bun:1.0

# Copy your SSL certificates
COPY ssl/certificate.pem /app/ssl/
COPY ssl/private.key /app/ssl/
RUN chmod 644 /app/ssl/certificate.pem
RUN chmod 600 /app/ssl/private.key

# Copy your application
COPY . /app
WORKDIR /app

# Start with your certificates
CMD ["./start.sh", "prod", "false", "/app", "3443", "/app/ssl/certificate.pem", "/app/ssl/private.key"]
```

### Docker Compose Example
```yaml
version: '3.8'
services:
  rip-server:
    build: .
    ports:
      - "3443:3443"  # HTTPS
      - "3000:3000"  # HTTP fallback
    volumes:
      - "/etc/letsencrypt/live/yourdomain.com:/app/ssl:ro"
    environment:
      - SSL_CERT_PATH=/app/ssl/fullchain.pem
      - SSL_KEY_PATH=/app/ssl/privkey.pem
    command: ["./start.sh", "prod", "false", "/app", "3443", "/app/ssl/fullchain.pem", "/app/ssl/privkey.pem"]
```

## 🛡️ Security Best Practices

### File Permissions
```bash
# Set correct permissions for certificate files
sudo chmod 644 /path/to/certificate.pem    # Certificate can be world-readable
sudo chmod 600 /path/to/private.key        # Private key should be owner-only
sudo chown root:ssl-cert /path/to/private.key  # Optional: use ssl-cert group
```

### Certificate Validation
```bash
# Verify your certificate and key match
openssl x509 -noout -modulus -in /path/to/certificate.pem | openssl md5
openssl rsa -noout -modulus -in /path/to/private.key | openssl md5
# The MD5 hashes should match

# Check certificate expiration
openssl x509 -noout -dates -in /path/to/certificate.pem
```

### Auto-Renewal with Let's Encrypt
```bash
# Example systemd service for certificate renewal
# /etc/systemd/system/rip-server-reload.service
[Unit]
Description=Reload Rip Server after SSL renewal
After=certbot.service

[Service]
Type=oneshot
ExecStart=/usr/local/bin/rip-server-reload.sh

# /usr/local/bin/rip-server-reload.sh
#!/bin/bash
# Gracefully restart Rip server to pickup new certificates
cd /path/to/rip/server && ./stop.sh && sleep 2 && ./start.sh prod false /app 3443 /etc/letsencrypt/live/yourdomain.com/fullchain.pem /etc/letsencrypt/live/yourdomain.com/privkey.pem
```

## 🧪 Testing Your Production Certificates

```bash
# Start server with your certificates
./start.sh prod false /app 3443 /path/to/cert.pem /path/to/key.pem

# Test HTTPS endpoint (no -k flag needed for trusted certificates!)
curl https://yourdomain.com:3443/health

# Verify SSL certificate details
openssl s_client -connect yourdomain.com:3443 -servername yourdomain.com < /dev/null 2>/dev/null | openssl x509 -noout -text
```

## 🌟 Production Deployment Checklist

- [ ] **Certificate files exist and are readable**
- [ ] **Private key has correct permissions (600)**
- [ ] **Certificate and key match (same modulus)**
- [ ] **Certificate is not expired**
- [ ] **Certificate includes full chain (if using Let's Encrypt)**
- [ ] **Firewall allows traffic on HTTPS port (3443)**
- [ ] **DNS points to your server**
- [ ] **Auto-renewal configured (if using Let's Encrypt)**

## 🎯 Zero-Downtime Certificate Updates

```bash
# 1. Update certificates in place
sudo cp new-certificate.pem /etc/ssl/certs/yourdomain.com.pem
sudo cp new-private.key /etc/ssl/private/yourdomain.com.key

# 2. Graceful restart (existing connections finish)
cd /path/to/rip/server
./stop.sh  # Graceful shutdown
./start.sh prod false /app 3443 /etc/ssl/certs/yourdomain.com.pem /etc/ssl/private/yourdomain.com.key

# Total downtime: ~2-3 seconds for process restart
```

---

**🔒 Your existing SSL certificates work seamlessly with the Rip Application Server!**