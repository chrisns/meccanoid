import Foundation
import CoreBluetooth
final class Probe: NSObject, CBCentralManagerDelegate, CBPeripheralDelegate {
 var central: CBCentralManager!
 var robot: CBPeripheral?
 var command: CBCharacteristic?
 var authenticated = false
 override init() { super.init(); central = CBCentralManager(delegate: self, queue: nil) }
 func centralManagerDidUpdateState(_ central: CBCentralManager) {
  print("Bluetooth state: \(central.state.rawValue)")
  if central.state == .poweredOn { central.scanForPeripherals(withServices: nil) }
 }
 func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral, advertisementData: [String: Any], rssi RSSI: NSNumber) {
  let name = peripheral.name ?? advertisementData[CBAdvertisementDataLocalNameKey] as? String ?? "unnamed"
  if name.lowercased().contains("mecc") { print("Device: \(name) \(peripheral.identifier) RSSI \(RSSI)") }
  if name.lowercased().contains("mecc") && robot == nil { robot = peripheral; central.stopScan(); peripheral.delegate = self; central.connect(peripheral) }
 }
 func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) { print("Connected \(peripheral.name ?? "")"); peripheral.discoverServices(nil) }
 func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) { print("Connection failed \(String(describing: error))") }
 func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) { for service in peripheral.services ?? [] { print("Service \(service.uuid)"); peripheral.discoverCharacteristics(nil, for: service) } }
 func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) { for c in service.characteristics ?? [] { print("Characteristic \(service.uuid) / \(c.uuid) properties \(c.properties.rawValue) detail \(c)"); if CommandLine.arguments.contains("--read-info") && c.properties.contains(.read) && service.uuid == CBUUID(string: "180A") { peripheral.readValue(for: c) }; if c.uuid == CBUUID(string: "FFF1") { peripheral.setNotifyValue(true, for: c) }; if c.uuid == CBUUID(string: "FFF2") { command = c } } }
 func send(_ peripheral: CBPeripheral, _ c: CBCharacteristic, _ bytes: [UInt8]) {
  var p = bytes + Array(repeating: UInt8(0), count: 18 - bytes.count)
  let sum = p.reduce(0) { $0 + Int($1) }; p += [UInt8(sum >> 8), UInt8(sum & 255)]
  print("TX " + p.map { String(format: "%02x", $0) }.joined(separator: " "))
  peripheral.writeValue(Data(p), for: c, type: CommandLine.arguments.contains("--without-response") ? .withoutResponse : .withResponse)
 }
 func testLights(_ peripheral: CBPeripheral, _ c: CBCharacteristic) {
  send(peripheral, c, [0x0d,2,2,0,0,255,255])
  if CommandLine.arguments.contains("--wake") {
   DispatchQueue.main.asyncAfter(deadline: .now() + 3) { self.send(peripheral, c, [0x1c,1,1,1,1]) }
   DispatchQueue.main.asyncAfter(deadline: .now() + 6) { self.send(peripheral, c, [0x19] + Array(repeating: 0x1d, count: 17)) }
   return
  }
  for (delay, colour) in (0..<30).map({ (3.0 + Double($0) * 5.0, $0 % 2 == 0 ? UInt8(7) : UInt8(56)) }) {
   DispatchQueue.main.asyncAfter(deadline: .now() + delay) { self.send(peripheral,c,[0x11,0,0,colour,0]) }
  }
 }
 func peripheral(_ peripheral: CBPeripheral, didWriteValueFor characteristic: CBCharacteristic, error: Error?) { print("Write \(characteristic.uuid): \(error.map { String(describing: $0) } ?? "acknowledged")") }
 func peripheral(_ peripheral: CBPeripheral, didUpdateNotificationStateFor characteristic: CBCharacteristic, error: Error?) {
  print("Notifications \(characteristic.isNotifying), error \(String(describing: error))")
  if characteristic.isNotifying, let c = command { send(peripheral,c,[0x1a,1,0,1]); DispatchQueue.main.asyncAfter(deadline: .now() + 2) { self.send(peripheral,c,[1]) } }
 }
 func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
  guard let data = characteristic.value else { return }
  let bytes = Array(data)
  print("RX \(characteristic.uuid): " + bytes.map { String(format: "%02x", $0) }.joined(separator: " "))
  if bytes.count >= 4 && bytes[0] == 0x1a && !authenticated {
   if bytes[1] == 0 && bytes[2] == 1 && bytes[3] == 255 { print("Connection rejected"); return }
   authenticated = true
   print("PIN response received")
   if let c = command {
    if CommandLine.arguments.contains("--lights") || CommandLine.arguments.contains("--wake") { testLights(peripheral,c) }
    for n in 1...170 { DispatchQueue.main.asyncAfter(deadline: .now() + Double(n)) { self.send(peripheral,c,[1]) } }
   }
  }
 }

}
setbuf(stdout, nil)
let probe = Probe()
RunLoop.main.run(until: Date(timeIntervalSinceNow: 180))
