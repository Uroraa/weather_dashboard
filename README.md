# Full-Stack IoT Sensor Dashboard 🚀

A modern, full-stack platform built with Node.js, Express, SQLite, and Vanilla JS/CSS for monitoring multiple ESP32 devices in real time with high aesthetic fidelity.

## Features Built
- **Authentication**: JWT & secure login flow.
- **Permissions**: Admin & standard user roles.
- **Database**: SQLite tracking Users, Devices, continuous sensor Readings, and Alert history.
- **Alert Logic**: Throttleable rules engine tracking High/Low boundaries (creates DB logs).
- **Socket.io**: Real-time chart visualization and telemetry push from backend to frontend without page reloads.
- **Email Notifications**: Nodemailer connected to ethereal test server.
- **Multi-tenant Devices**: Users can register 'N' ESP32 chips, each getting a unique UUID API Key.

---

## 💻 1. Installation

```bash
git clone <repo-url>
cd weather_dashboard
npm install
```

## ⚙️ 2. Configuration & `.env`

The system automatically loads from `.env` in the project root. Sample config:
```env
PORT=3000
JWT_SECRET=super_secret_jwt_key_please_change_in_production
DB_PATH=./database.sqlite
SMTP_HOST=smtp.ethereal.email
SMTP_PORT=587
SMTP_USER=test_user
SMTP_PASS=test_pass
SMTP_FROM=alerts@iot-dashboard.local
```

## 🚀 3. Running the Server

Start the platform in development mode (hot reloads automatically using nodemon):
```bash
npm run dev
```
*(Optionally run explicitly via `node server/index.js` for production)*

Navigate to the dashboard in your browser:
➡️ [http://localhost:3000](http://localhost:3000)

## 🔑 4. Seeded Accounts
On first startup, the application creates a `database.sqlite` file and seeds exact credentials for you to explore with.

**Admin Account:**
- **Email:** `admin@example.com`
- **Password:** `Admin123!`
*(Has access to the "Admin Portal" navigation item, can list, downgrade or delete any user/device.)*

**Regular User Account:**
- **Email:** `user@example.com`
- **Password:** `User123!`
*(Has one "Office Sensor" prototype device already allocated with 30 past readings spanning the last hour).*

## 📡 5. Pushing Data & ESP32 Integration

**Endpoint**: `POST /api/data`
**Auth Header Required**: `x-device-key: <device_uuid_here>`

ESP32 libraries easily support putting custom headers in HTTP. Your firmware simply needs to parse `temperature` and `humidity` to standard JSON.

### Simulating an ESP32 Locally
If you want to view real-time frontend charts naturally update without flashing physical hardware:

1. Obtain your `API_KEY`. (Log-in as the seeded user, navigate to the Devices tab, and hit "Copy").
2. Run the Node.js automation script from your terminal:

```bash
node scripts/simulate_esp32.js <PASTE_YOUR_COPIED_API_KEY_HERE>
```

**Alternative Windows Powershell simulation:**
```powershell
Invoke-RestMethod -Uri "http://localhost:3000/api/data" -Method Post -Headers @{"x-device-key"="PASTE_YOUR_KEY"} -ContentType "application/json" -Body '{"temperature": 27.5, "humidity": 65}'
```

**Alternative cURL Bash simulation:**
```bash
curl -X POST http://localhost:3000/api/data \\
  -H "Content-Type: application/json" \\
  -H "x-device-key: PASTE_YOUR_KEY" \\
  -d '{"temperature": 25.4, "humidity": 61}'
```
