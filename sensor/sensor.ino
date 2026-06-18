#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include "DHT.h"
#include <Preferences.h>
#include <math.h>   // for log(), cos(), sqrt()
#include <WiFiManager.h> // https://github.com/tzapu/WiFiManager

// -- MQTT --
char mqtt_server[40] = "192.168.2.76"; // default, will be overwritten by WiFiManager
const int   mqtt_port   = 1883;

bool shouldSaveConfig = false;
void saveConfigCallback() {
    shouldSaveConfig = true;
}

// -- DHT --
#define DHTPIN  4
#define DHTTYPE DHT11

// -- Interval --
const unsigned long SEND_INTERVAL   = 5000;  // 30s gửi data
const unsigned long PROVISION_RETRY = 10000;  // 10s thử lại nếu chưa provision

DHT          dht(DHTPIN, DHTTYPE);
WiFiClient   espClient;
PubSubClient client(espClient);
Preferences  prefs;

String deviceApiKey = "";
int    deviceId     = -1;
bool   provisioned  = false;

// ============================================================
// MAC Address
// ============================================================
String getMacAddress() {
    uint8_t mac[6];
    WiFi.macAddress(mac);
    char buf[18];
    snprintf(buf, sizeof(buf), "%02X:%02X:%02X:%02X:%02X:%02X",
             mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
    return String(buf);
}

// ============================================================
// WiFi
// ============================================================
// setup_wifi() has been replaced by WiFiManager in setup()

// ============================================================
// MQTT callback — nhận config trả về từ server
// ============================================================
void mqttCallback(char* topic, byte* payload, unsigned int length) {
    String msg = "";
    for (unsigned int i = 0; i < length; i++) msg += (char)payload[i];
    Serial.println("[MQTT IN] " + String(topic) + ": " + msg);

    StaticJsonDocument<256> doc;
    if (deserializeJson(doc, msg) != DeserializationError::Ok) return;

    if (doc.containsKey("action") && doc["action"] == "reset") {
        Serial.println("[MQTT] Received RESET command! Wiping flash...");
        prefs.begin("device", false);
        prefs.clear();
        prefs.end();
        
        WiFiManager wm;
        wm.resetSettings();
        
        delay(1000);
        ESP.restart();
        return;
    }

    if (doc.containsKey("device_id") && doc.containsKey("api_key")) {
        int    newId  = doc["device_id"].as<int>();
        String newKey = doc["api_key"].as<String>();

        // Lưu vào flash
        prefs.begin("device", false);
        prefs.putInt("device_id", newId);
        prefs.putString("api_key", newKey);
        prefs.end();

        deviceId     = newId;
        deviceApiKey = newKey;
        provisioned  = true;

        Serial.println("[Provision] Xong! device_id=" + String(deviceId));
        // Stay connected — server validates by api_key in the topic, not session credentials.
        // Main loop will start publishing data immediately with the updated deviceApiKey.
    }
}

// ============================================================
// Provision client — không cần auth, chỉ để đăng ký lần đầu
// prefix "provision-" → server cho phép kết nối không cần credentials
// ============================================================
void sendProvisionRequest() {
    String mac      = getMacAddress();
    String clientId = "provision-" + mac;

    if (client.connect(clientId.c_str())) {
        String configTopic = "devices/" + mac + "/config";
        client.subscribe(configTopic.c_str(), 1);

        StaticJsonDocument<128> doc;
        doc["mac_address"]      = mac;
        doc["chip_model"]       = String(ESP.getChipModel());
        doc["firmware_version"] = "1.0.0";

        String payload;
        serializeJson(doc, payload);
        client.publish("devices/register", payload.c_str());
        Serial.println("[Provision] Đã gửi yêu cầu đăng ký");
    } else {
        Serial.println("[Provision] Kết nối thất bại rc=" + String(client.state()));
    }
}

// ============================================================
// Kết nối thông thường sau khi đã có credentials
// username = device_id (string), password = api_key
// Key KHÔNG bao giờ xuất hiện trên bất kỳ topic nào
// ============================================================
void reconnectWithAuth() {
    String mac      = getMacAddress();
    String clientId = "ESP32-" + mac;
    String username = String(deviceId);

    while (!client.connected()) {
        Serial.print("Connecting MQTT with auth...");
        if (client.connect(clientId.c_str(),
                           username.c_str(),        // username = device_id
                           deviceApiKey.c_str())) { // password = api_key (trong CONNECT packet)
            Serial.println(" OK");
            client.subscribe(("devices/" + mac + "/config").c_str(), 1);
        } else {
            int state = client.state();
            Serial.println(" failed rc=" + String(state) + " — retry 5s");
            
            // If the server rejects the credentials (e.g., API key deleted/invalid), 
            // clear the stored credentials and restart to trigger re-provisioning.
            // MQTT_CONNECT_BAD_CREDENTIALS = 4, MQTT_CONNECT_UNAUTHORIZED = 5
            if (state == 4 || state == 5) {
                Serial.println("Invalid credentials. Clearing NVS and restarting...");
                prefs.begin("device", false);
                prefs.remove("device_id");
                prefs.remove("api_key");
                prefs.end();
                
                WiFiManager wm;
                wm.resetSettings();

                // We keep mqtt_server, only remove provisioned credentials
                delay(1000);
                ESP.restart();
            }
            
            delay(5000);
        }
    }
}

// ============================================================
// Setup
// ============================================================
void setup() {
    Serial.begin(115200);
    dht.begin();

    prefs.begin("device", true);
    deviceId     = prefs.getInt("device_id", -1);
    deviceApiKey = prefs.getString("api_key", "");
    String saved_mqtt = prefs.getString("mqtt_server", "192.168.2.76");
    strlcpy(mqtt_server, saved_mqtt.c_str(), sizeof(mqtt_server));
    prefs.end();

    if (deviceId != -1 && deviceApiKey.length() > 0) {
        provisioned = true;
        Serial.println("[Flash] device_id=" + String(deviceId));
    } else {
        Serial.println("[Flash] Chưa provision");
    }

    WiFiManager wm;
    wm.setSaveConfigCallback(saveConfigCallback);
    WiFiManagerParameter custom_mqtt_server("server", "mqtt server", mqtt_server, 40);
    wm.addParameter(&custom_mqtt_server);
    wm.setTimeout(20); // portal timeout in seconds

    String mac = getMacAddress();
    mac.replace(":", "");
    String apName = "Sensor-Setup-" + mac;
    
    if (!wm.autoConnect(apName.c_str())) {
        Serial.println("Failed to connect and hit timeout");
        delay(3000);
        ESP.restart();
    }

    Serial.println("Connected to WiFi!");

    strlcpy(mqtt_server, custom_mqtt_server.getValue(), sizeof(mqtt_server));
    if (shouldSaveConfig) {
        prefs.begin("device", false);
        prefs.putString("mqtt_server", mqtt_server);
        prefs.end();
        Serial.println("Saved new MQTT server to flash");
    }

    client.setServer(mqtt_server, mqtt_port);
    client.setCallback(mqttCallback);
}

// ============================================================
// Loop
// ============================================================
void loop() {
    if (WiFi.status() != WL_CONNECTED) {
        // WiFi connection lost
        Serial.println("WiFi disconnected. Reconnecting...");
        WiFi.reconnect();
        unsigned long startAttempt = millis();
        while (WiFi.status() != WL_CONNECTED && millis() - startAttempt < 10000) {
            delay(500);
            Serial.print(".");
        }
        if (WiFi.status() != WL_CONNECTED) {
            Serial.println("Failed to reconnect WiFi. Restarting...");
            ESP.restart();
        }
        Serial.println("\nWiFi reconnected");
    }

    if (!provisioned) {
        static unsigned long lastRetry = 0;
        if (millis() - lastRetry > PROVISION_RETRY) {
            lastRetry = millis();
            if (!client.connected()) sendProvisionRequest();
        }
        client.loop();
        return;
    }

    if (!client.connected()) reconnectWithAuth();
    client.loop();

    static unsigned long lastMsg = 0;
    if (millis() - lastMsg > SEND_INTERVAL) {
        lastMsg = millis();

        float temperature = dht.readTemperature();
        float humidity    = dht.readHumidity();

        if (isnan(temperature) || isnan(humidity)) {
            Serial.println("DHT read failed! Using mock data (Gaussian).");

            // -- Box-Muller transform: uniform → standard normal --
            // u1, u2 in (0, 1)
            float u1 = (float)(esp_random() % 1000000 + 1) / 1000000.0f;
            float u2 = (float)(esp_random() % 1000000 + 1) / 1000000.0f;
            float z0 = sqrt(-2.0f * log(u1)) * cos(2.0f * M_PI * u2);

            // Second independent normal for humidity
            float u3 = (float)(esp_random() % 1000000 + 1) / 1000000.0f;
            float u4 = (float)(esp_random() % 1000000 + 1) / 1000000.0f;
            float z1 = sqrt(-2.0f * log(u3)) * cos(2.0f * M_PI * u4);

            // Mock values: temp ~ N(26, 1.5²)  |  hum ~ N(55, 4²)
            temperature = 26.0f + z0 * 1.5f;
            humidity    = 55.0f + z1 * 4.0f;

            // Clamp to physical bounds
            temperature = max(0.0f, min(50.0f, temperature));
            humidity    = max(0.0f, min(100.0f, humidity));
        }

        // -- Generate Mock AQI --
        static float aqi_noise_prev = 0.0f;
        static bool aqi_first_run = true;
        
        // Calculate hour of day from uptime
        float hour = fmod((millis() / 3600000.0f), 24.0f);
        float daily_cycle = 40.0f + 20.0f * sin(2.0f * M_PI * (hour - 6.0f) / 24.0f);
        
        float aqi_rand_z;
        {
            float u1 = (float)(esp_random() % 1000000 + 1) / 1000000.0f;
            float u2 = (float)(esp_random() % 1000000 + 1) / 1000000.0f;
            aqi_rand_z = sqrt(-2.0f * log(u1)) * cos(2.0f * M_PI * u2);
        }
        
        if (aqi_first_run) {
            aqi_noise_prev = aqi_rand_z * 5.0f;
            aqi_first_run = false;
        } else {
            aqi_noise_prev = 0.85f * aqi_noise_prev + (aqi_rand_z * 3.0f);
        }
        
        float aqi_spike = 0.0f;
        if ((esp_random() % 100) < 5) { // 5% probability
            aqi_spike = 20.0f + (esp_random() % 40000) / 1000.0f; // Uniform(20, 60)
        }
        
        float aqi = daily_cycle + aqi_noise_prev + aqi_spike;
        aqi = max(0.0f, min(300.0f, aqi)); // Clip(0, 300)

        // Topic vẫn dùng api_key — không thay đổi backend
        String topic   = "device/" + deviceApiKey + "/data";
        String payload = "{\"temperature\":" + String(temperature, 1) +
                         ",\"humidity\":"    + String(humidity, 1)    + 
                         ",\"aqi\":"         + String(aqi, 1)         + "}";

        if (client.publish(topic.c_str(), payload.c_str())) {
            Serial.println("[MQTT OUT] " + payload);
        } else {
            Serial.println("[MQTT OUT] Publish thất bại!");
        }
    }
}
