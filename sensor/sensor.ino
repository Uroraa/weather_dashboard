#include <WiFi.h>
#include <PubSubClient.h>
#include "DHT.h"

// -- WiFi Credentials --
const char* ssid = "Long";
const char* password = "01234567";

// -- Server Details --
const char* mqtt_server = "192.168.1.5";
const int mqtt_port = 1883;

// Your device's API Key
const char* deviceApiKey = "91bec79d-6815-4b58-a58b-d122526fdd19"; 

// The topic to publish to
const char* mqtt_topic = "device/91bec79d-6815-4b58-a58b-d122526fdd19/data";

// -- DHT11 Config --
#define DHTPIN 4        // GPIO 4
#define DHTTYPE DHT11

DHT dht(DHTPIN, DHTTYPE);
WiFiClient espClient;
PubSubClient client(espClient);

void setup_wifi() {
  delay(10);
  Serial.println();
  Serial.print("Connecting to ");
  Serial.println(ssid);

  WiFi.begin(ssid, password);

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println("\nWiFi connected");
  Serial.println("IP address: ");
  Serial.println(WiFi.localIP());
}

void reconnect() {
  while (!client.connected()) {
    Serial.print("Attempting MQTT connection...");
    
    // Create a random client ID
    String clientId = "ESP32Client-";
    clientId += String(random(0xffff), HEX);
    
    // Connect to the MQTT broker
    if (client.connect(clientId.c_str())) {
      Serial.println("connected to MQTT broker!");
    } else {
      Serial.print("failed, rc=");
      Serial.print(client.state());
      Serial.println(" try again in 5 seconds");
      delay(5000);
    }
  }
}

void setup() {
  Serial.begin(115200);
  
  dht.begin();
  
  setup_wifi();
  
  client.setServer(mqtt_server, mqtt_port);
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    setup_wifi();
  }
  
  if (!client.connected()) {
    reconnect();
  }
  
  client.loop(); // Required to maintain MQTT connection

  static unsigned long lastMsg = 0;
  unsigned long now = millis();
  
  // Publish data every 10 seconds
  if (now - lastMsg > 10000) {
    lastMsg = now;

    // --- Read DHT11 ---
    float temperature = dht.readTemperature();
    float humidity = dht.readHumidity();

    if (isnan(temperature) || isnan(humidity)) {
      Serial.println("Failed to read from DHT sensor!");
      return;
    }

    // Build JSON payload
    String payload = "{\"temperature\":" + String(temperature) + 
                     ",\"humidity\":" + String(humidity) + "}";

    Serial.print("Sending MQTT Data to topic [");
    Serial.print(mqtt_topic);
    Serial.print("]: ");
    Serial.println(payload);

    if (client.publish(mqtt_topic, payload.c_str())) {
      Serial.println("Publish successful!");
    } else {
      Serial.println("Publish failed!");
    }
  }
}