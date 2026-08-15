#!/usr/bin/env python3
# SPEC: 实机驱动：登录流（按标签定位字段→点击→输入→点连接）
import os, re, subprocess, sys, time

A = ['adb', '-s', os.environ.get('ADB_SERIAL', 'emulator-5554')]
BASE = os.environ.get('E2E_BASE', 'http://10.0.2.2:3180')
DEVICE = os.environ.get('E2E_DEVICE', 'WHALE-E2EE-DEVK')
PW = os.environ.get('E2E_PW', '')

def dump():
    subprocess.run(A + ['shell', 'uiautomator', 'dump', '/sdcard/ui.xml'], capture_output=True)
    subprocess.run(A + ['pull', '/sdcard/ui.xml', '/tmp/ui.xml'], capture_output=True)
    return open('/tmp/ui.xml', encoding='utf-8', errors='ignore').read()

def tap_label(label):
    xml = dump()
    m = re.search(r'<node[^>]*text="%s"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"' % re.escape(label), xml)
    if not m:
        print('NOMATCH:', label)
        sys.exit(1)
    x = (int(m.group(1)) + int(m.group(3))) // 2
    y = (int(m.group(2)) + int(m.group(4))) // 2
    subprocess.run(A + ['shell', 'input', 'tap', str(x), str(y)])
    print('tap:', label, x, y)

def type_text(t):
    subprocess.run(A + ['shell', 'input', 'text', t])
    print('type:', t[:12], '...')

def tap_button_by_enabled():
    xml = dump()
    nodes = list(re.finditer(r'<node[^>]*clickable="true"[^>]*>', xml))
    last = nodes[-1]
    en = re.search(r'enabled="([^"]*)"', last.group(0))
    b = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', last.group(0))
    x = (int(b.group(1)) + int(b.group(3))) // 2
    y = (int(b.group(2)) + int(b.group(4))) // 2
    print('button enabled=', en.group(1) if en else None, 'tap', x, y)
    subprocess.run(A + ['shell', 'input', 'tap', str(x), str(y)])

if __name__ == '__main__':
    tap_label('主机地址 http://IP:3180')
    time.sleep(0.5)
    type_text(BASE)
    time.sleep(0.5)
    tap_label('设备 ID WHALE-XXXX-XXXX')
    time.sleep(0.5)
    type_text(DEVICE)
    time.sleep(0.5)
    tap_label('长期密码')
    time.sleep(0.5)
    type_text(PW)
    time.sleep(0.5)
    subprocess.run(A + ['shell', 'input', 'keyevent', '4'])
    time.sleep(1)
    tap_button_by_enabled()
