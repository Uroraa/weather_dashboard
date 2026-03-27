#include <WiFi.h>
#include <HTTPClient.h>
#include "DHT.h"

// -- WiFi Credentials --
const char* ssid = "Sxmh1";
const char* password = "123456789@";

// -- Server Details --
const char* serverUrl = "http://192.168.3.86:3000/api/data";
const char* deviceApiKey = "e47c65de-e907-4e86-b6de-7f7266b07943"; 

// -- DHT11 Config --
#define DHTPIN 4        // GPIO 4
#define DHTTYPE DHT11

DHT dht(DHTPIN, DHTTYPE);

void setup() {
  Serial.begin(115200);

  dht.begin(); // init DHT

  // Connect to WiFi
  WiFi.begin(ssid, password);
  Serial.println("Connecting to WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nConnected to WiFi!");
}

void loop() {
  if (WiFi.status() == WL_CONNECTED) {
    HTTPClient http;

    http.begin(serverUrl);

    http.addHeader("Content-Type", "application/json");
    http.addHeader("x-device-key", deviceApiKey);

    // --- Đọc DHT11 ---
    float temperature = dht.readTemperature();
    float humidity = dht.readHumidity();

    // Check lỗi đọc cảm biến
    if (isnan(temperature) || isnan(humidity)) {
      Serial.println("Failed to read from DHT sensor!");
      delay(2000);
      return;
    }

    // JSON payload
    String payload = "{\"temperature\":" + String(temperature) + 
                     ",\"humidity\":" + String(humidity) + "}";

    Serial.println("Sending data: " + payload);

    int httpResponseCode = http.POST(payload);

    if (httpResponseCode > 0) {
      Serial.print("HTTP Response code: ");
      Serial.println(httpResponseCode);
      String response = http.getString();
      Serial.println(response);
    } else {
      Serial.print("Error code: ");
      Serial.println(httpResponseCode);
    }

    http.end();
  } else {
    Serial.println("WiFi Disconnected");
  }

  delay(10000); // gửi mỗi 10s
}