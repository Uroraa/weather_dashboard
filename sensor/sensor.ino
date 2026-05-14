#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include "DHT.h"
#include <Preferences.h>

// -- WiFi --
const char* ssid = "Sxmh1";
const char* password = "123456789@";

// -- MQTT --
const char* mqtt_server = "192.168.2.95";
const int   mqtt_port   = 1883;

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
void setup_wifi() {
    Serial.print("Connecting WiFi...");
    WiFi.begin(ssid, password);
    while (WiFi.status() != WL_CONNECTED) {
        delay(500); Serial.print(".");
    }
    Serial.println(" OK — IP: " + WiFi.localIP().toString());
}

// ============================================================
// MQTT callback — nhận config trả về từ server
// ============================================================
void mqttCallback(char* topic, byte* payload, unsigned int length) {
    String msg = "";
    for (unsigned int i = 0; i < length; i++) msg += (char)payload[i];
    Serial.println("[MQTT IN] " + String(topic) + ": " + msg);

    StaticJsonDocument<256> doc;
    if (deserializeJson(doc, msg) != DeserializationError::Ok) return;

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
            Serial.println(" failed rc=" + String(client.state()) + " — retry 5s");
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
    setup_wifi();

    prefs.begin("device", true);
    deviceId     = prefs.getInt("device_id", -1);
    deviceApiKey = prefs.getString("api_key", "");
    prefs.end();

    if (deviceId != -1 && deviceApiKey.length() > 0) {
        provisioned = true;
        Serial.println("[Flash] device_id=" + String(deviceId));
    } else {
        Serial.println("[Flash] Chưa provision");
    }

    client.setServer(mqtt_server, mqtt_port);
    client.setCallback(mqttCallback);
}

// ============================================================
// Loop
// ============================================================
void loop() {
    if (WiFi.status() != WL_CONNECTED) setup_wifi();

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
            Serial.println("DHT read failed!");
            return;
        }

        // Topic vẫn dùng api_key — không thay đổi backend
        String topic   = "device/" + deviceApiKey + "/data";
        String payload = "{\"temperature\":" + String(temperature, 1) +
                         ",\"humidity\":"    + String(humidity, 1)    + "}";

        if (client.publish(topic.c_str(), payload.c_str())) {
            Serial.println("[MQTT OUT] " + payload);
        } else {
            Serial.println("[MQTT OUT] Publish thất bại!");
        }
    }
}
