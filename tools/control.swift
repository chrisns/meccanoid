import Foundation
import CoreBluetooth

// Interactive diagnostic controller. All BLE operations stay on the main queue.
final class Controller: NSObject, CBCentralManagerDelegate, CBPeripheralDelegate {
 var central: CBCentralManager!
 var robot: CBPeripheral?
 var command: CBCharacteristic?
 var notify: CBCharacteristic?
 var authenticated = false
 var pinSent = false
 var pose: [UInt8]?
 var heartbeat: Timer?
 var busy = false
 var epoch = 0
 override init() { super.init(); central = CBCentralManager(delegate:self,queue:nil) }
 func centralManagerDidUpdateState(_ central: CBCentralManager) {
  print("Bluetooth state \(central.state.rawValue)")
  if central.state == .poweredOn { central.scanForPeripherals(withServices:[CBUUID(string:"FFF0")]) }
 }
 func centralManager(_ central: CBCentralManager,didDiscover peripheral: CBPeripheral,advertisementData:[String:Any],rssi RSSI:NSNumber) {
  guard robot == nil, (peripheral.name ?? "").lowercased().contains("mecc") else { return }
  robot=peripheral;central.stopScan();peripheral.delegate=self;print("Connecting \(peripheral.name ?? "")");central.connect(peripheral)
 }
 func centralManager(_ central:CBCentralManager,didConnect peripheral:CBPeripheral) { peripheral.discoverServices([CBUUID(string:"FFF0")]) }
 func centralManager(_ central:CBCentralManager,didFailToConnect peripheral:CBPeripheral,error:Error?) {print("CONNECT FAILED \(String(describing:error))")}
 func centralManager(_ central:CBCentralManager,didDisconnectPeripheral peripheral:CBPeripheral,error:Error?) {authenticated=false;heartbeat?.invalidate();print("DISCONNECTED \(String(describing:error))");exit(0)}
 func peripheral(_ peripheral:CBPeripheral,didDiscoverServices error:Error?) {for s in peripheral.services ?? [] {peripheral.discoverCharacteristics([CBUUID(string:"FFF1"),CBUUID(string:"FFF2")],for:s)}}
 func peripheral(_ peripheral:CBPeripheral,didDiscoverCharacteristicsFor service:CBService,error:Error?) {
  for c in service.characteristics ?? [] {if c.uuid == CBUUID(string:"FFF2"){command=c};if c.uuid == CBUUID(string:"FFF1"){notify=c}}
  if let n=notify,command != nil {peripheral.setNotifyValue(true,for:n)}
 }
 func peripheral(_ peripheral:CBPeripheral,didUpdateNotificationStateFor characteristic:CBCharacteristic,error:Error?) {
  if characteristic.isNotifying && !pinSent {pinSent=true;send([0x1a,1,0,1])}
 }
 func send(_ bytes:[UInt8],quiet:Bool=false) {
  guard let p=robot,let c=command,bytes.count<=18 else {print("NOT CONNECTED");return}
  var frame=bytes+Array(repeating:UInt8(0),count:18-bytes.count)
  let sum=frame.reduce(0){$0+Int($1)};frame += [UInt8(sum>>8),UInt8(sum&255)]
  if !quiet {print("TX "+frame.map{String(format:"%02x",$0)}.joined(separator:" "))}
  p.writeValue(Data(frame),for:c,type:.withoutResponse)
 }
 func peripheral(_ peripheral:CBPeripheral,didUpdateValueFor characteristic:CBCharacteristic,error:Error?) {
  guard let data=characteristic.value else{return};let b=Array(data)
  guard b.count==20,b.prefix(18).reduce(0,{$0+Int($1)}) == Int(b[18])*256+Int(b[19]) else{print("INVALID RX \(data as NSData)");return}
  if b[0] != 1 {print("RX "+b.map{String(format:"%02x",$0)}.joined(separator:" "))}
  if b[0]==0x1a && !authenticated {
   if Array(b[1...3]) == [0,1,255] {print("PIN REJECTED");return}
   authenticated=true;print("AUTHENTICATED — ready for commands");send([0x0d,2,2,0,0,255,255]);send([9])
   heartbeat=Timer.scheduledTimer(withTimeInterval:1,repeats:true){_ in self.send([1],quiet:true)}
  }
  if b[0]==9 {pose=Array(b[1...8]);print("POSE \(pose!)")}
  if b[0]==1 {let summary="STATUS buttons=\(b[8]) batteryCode=\(b[12]) LIM=\(b[13]) presets=\(b[14]) error=\(b[16])";if summary != lastStatus {print(summary);lastStatus=summary}}
 }
 var lastStatus=""
 func handle(_ line:String) {
  let a=line.split(separator:" ").map(String.init);guard let cmd=a.first else{return}
  if cmd=="quit" {send([0x0d,2,2,0,0,255,255]);if let p=robot{central.cancelPeripheralConnection(p)};return}
  guard authenticated else{print("WAIT FOR AUTHENTICATION");return}
  if busy && cmd != "status" && cmd != "pose" && cmd != "stop" {print("WAIT: bounded test running");return}
  let nums=a.dropFirst().compactMap{Int($0)}
  switch cmd {
  case "read":if nums.count>=1 && [2,3,7,10,14,15,16,24,29,30,32].contains(nums[0]) && nums.dropFirst().allSatisfy({0...255 ~= $0}) && nums.count<=3 {send(nums.map{UInt8($0)})}
  case "mode":if nums.count==1 && [2,4].contains(nums[0]) {send([0x0b]+Array(repeating:UInt8(nums[0]),count:16));pose=nil}
  case "clock":
   let parts=Calendar.current.dateComponents([.year,.month,.day,.hour,.minute],from:Date())
   let h24=parts.hour!,h=(h24%12 == 0 ? 12:h24%12),m=parts.minute!,y=parts.year!
   send([0x1b,UInt8(h/10),UInt8(h%10),UInt8(m/10),UInt8(m%10),h24>=12 ? 1:0,0,UInt8(parts.month!),UInt8(parts.day!),UInt8(y/1000%10),UInt8(y/100%10),UInt8(y/10%10),UInt8(y%10)])
   print("Local clock sent; verify with read 29 and preset 18")
  case "status":lastStatus="";send([1])
  case "pose":send([9])
  case "eyes":if nums.count==3 && nums.allSatisfy({0...7 ~= $0}) {send([0x11,0,0,UInt8(nums[1]*8+nums[0]),UInt8(nums[2])])}
  case "chest":if nums.count==1 && 0...15 ~= nums[0] {send([0x1c]+(0..<4).map{UInt8((nums[0]>>$0)&1)})}
  case "led":if nums.count==2 && 0...7 ~= nums[0] && 0...7 ~= nums[1] {var colours=Array(repeating:UInt8(0),count:8);colours[nums[0]]=UInt8(nums[1]);send([0x0c]+colours+Array(repeating:4,count:8)+[0])}
  case "jog":
   guard nums.count==2,0...7 ~= nums[0],(-8...8).contains(nums[1]),let before=pose else{print("jog SLOT DELTA requires fresh pose; delta -8…8");return}
   let value=Int(before[nums[0]])+nums[1];guard 24...232 ~= value else{print("OUTSIDE RANGE");return}
   busy=true;epoch += 1;let generation=epoch;var next=before;next[nums[0]]=UInt8(value);print("JOG slot \(nums[0]) \(before[nums[0]]) → \(value), restore in 1 second");send([8]+next+Array(repeating:1,count:9))
   DispatchQueue.main.asyncAfter(deadline:.now()+0.6){if generation == self.epoch {self.send([9])}}
   DispatchQueue.main.asyncAfter(deadline:.now()+1.2){if generation == self.epoch {self.send([8]+before+Array(repeating:1,count:9));self.busy=false;self.send([9])}}
  case "sweep":
   guard nums.count==1,0...7 ~= nums[0],let before=pose else{print("Read pose before sweep SLOT");return}
   let slot=nums[0],base=Int(before[slot]);guard 24...232 ~= base else{return}
   busy=true;epoch += 1;let generation=epoch
   print("SWEEP slot \(slot), baseline \(base), ±24 bounded, 30 seconds")
   send([0x0b]+Array(repeating:2,count:16))
   for n in 0..<150 {
    DispatchQueue.main.asyncAfter(deadline:.now()+Double(n)*0.2) {
     guard generation == self.epoch,self.authenticated else{return}
     var target=before
     let offset=Int((sin(Double(n)*0.2*Double.pi/2)*24).rounded())
     target[slot]=UInt8(max(24,min(232,base+offset)))
     self.send([8]+target+Array(repeating:1,count:9),quiet:true)
    }
   }
   DispatchQueue.main.asyncAfter(deadline:.now()+30) {guard generation == self.epoch else{return};self.send([8]+before+Array(repeating:1,count:9));self.busy=false;print("SWEEP COMPLETE");self.send([9])}
  case "wheel":
   guard nums.count>=2,nums.count<=4,0...1 ~= nums[0],[-1,1].contains(nums[1]) else{return}
   let speed=nums.count>2 ? nums[2]:40, duration=nums.count>3 ? nums[3]:200
   guard 1...100 ~= speed,50...500 ~= duration else{print("Speed 1…100; pulse 50…500 ms");return};busy=true
   let dir:UInt8=nums[1]>0 ? 1:2;send([0x0d,dir,dir,nums[0]==0 ? UInt8(speed):0,nums[0]==1 ? UInt8(speed):0,255,255])
   DispatchQueue.main.asyncAfter(deadline:.now()+Double(duration)/1000){self.send([0x0d,2,2,0,0,255,255]);self.busy=false}
  case "preset":if nums.count>=1 && 1...255 ~= nums[0] {let variant=nums.count>1 ? nums[1]:0;if 0...255 ~= variant {pose=nil;send([0x19,UInt8(nums[0]),UInt8(variant)])}}
  case "lim":if nums.count==1 && 1...255 ~= nums[0] {pose=nil;send([0x15,UInt8(nums[0])])}
  case "stop":epoch += 1;busy=false;send([0x0d,2,2,0,0,255,255])
  default:print("Commands: status | pose | read COMMAND [ARG] | clock | mode 2/4 | eyes R G B | chest MASK | led SLOT CODE | jog SLOT DELTA | sweep SLOT | wheel SIDE SIGN [SPEED] [MS] | preset ID [VARIANT] | lim SLOT | stop | quit")
  }
 }
}
setbuf(stdout,nil)
let controller=Controller()
DispatchQueue.global().async {while let line=readLine(){DispatchQueue.main.async{controller.handle(line)}}}
RunLoop.main.run()
