import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebBluetoothTransport } from '../src/meccanoid.js';
import { pin, packet } from '../src/protocol.js';

test('browser transport subscribes before PIN, waits for robot reply, and uses the intended service', async () => {
  const calls=[];
  const notify = new EventTarget();
  notify.startNotifications=async()=>calls.push('subscribe');
  const command={writeValueWithoutResponse:async data=>{
    calls.push('write'); assert.deepEqual(data,pin());
    const reply=packet(0x1a,[1,0,1]);
    notify.value=new DataView(reply.buffer);notify.dispatchEvent(new Event('characteristicvaluechanged'));
  }};
  const device=new EventTarget();device.name='MECCANOID test';
  device.gatt={connected:false,connect:async()=>{
    device.gatt.connected=true;
    return {getPrimaryService:async uuid=>{
      assert.equal(uuid,0xfff0);
      return {getCharacteristic:async uuid=>uuid===0xfff2?command:notify};
    }};
  },disconnect:()=>{device.gatt.connected=false;device.dispatchEvent(new Event('gattserverdisconnected'));}};
  const original=Object.getOwnPropertyDescriptor(globalThis,'navigator');
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{bluetooth:{requestDevice:async options=>{
    assert.deepEqual(options.optionalServices,[0xfff0]);return device;
  }}}});
  try {
    const transport=new WebBluetoothTransport();
    assert.equal(await transport.connect(),'MECCANOID test');
    assert.deepEqual(calls,['subscribe','write']);
    let disconnects=0;transport.addEventListener('disconnect',()=>disconnects++);
    transport.disconnect();assert.equal(disconnects,1);
    await assert.rejects(transport.write(pin()),/disconnected/);
  } finally {
    if(original) Object.defineProperty(globalThis,'navigator',original);
    else delete globalThis.navigator;
  }
});
