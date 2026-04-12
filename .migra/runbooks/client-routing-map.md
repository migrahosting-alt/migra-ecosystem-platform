# Client Domain Routing Map

Only client-facing domains are included here (internal/platform domains excluded).

## MigraDrive Note (2026-04-01)
- The only human-facing MigraDrive URL is `https://migradrive.com`.
- `s3.migradrive.com` is a technical storage endpoint, not a user-facing entry point.
- Active MigraDrive storage traffic should route through the shared gateway at `https://10.1.10.240`.

## Targets → Client Domains

### http://10.1.10.104:80
- premtint.com
- www.premtint.com

### http://10.1.10.53:80
- lituationdjs.com
- www.lituationdjs.com

### http://127.0.0.1:3003/
- voice.migrahosting.com

### http://127.0.0.1:3003/widgets/
- voice.migrahosting.com

### http://127.0.0.1:3003/ws/admin
- voice.migrahosting.com

### http://127.0.0.1:4242
- www.migrahosting.com

### https://10.1.10.240
- s3.migradrive.com

### https://10.1.10.70:8006
- pve.migrahosting.com
