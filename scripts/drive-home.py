#!/usr/bin/env python3
# SPEC: 实机驱动：主页→新建会话→发任务（真实点击）
import os, re, subprocess, sys, time

A = ['adb', '-s', os.environ.get('ADB_SERIAL', 'emulator-5554')]

def dump():
    subprocess.run(A + ['shell', 'uiautomator', 'dump', '/sdcard/ui.xml'], capture_output=True)
    subprocess.run(A + ['pull', '/sdcard/ui.xml', '/tmp/ui.xml'], capture_output=True)
    return open('/tmp/ui.xml', encoding='utf-8', errors='ignore').read()

def tap_label(label, idx=0):
    xml = dump()
    ms = list(re.finditer(r'<node[^>]*text="%s"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"' % re.escape(label), xml))
    if not ms:
        print('NOMATCH:', label)
        sys.exit(1)
    m = ms[min(idx, len(ms) - 1)]
    x = (int(m.group(1)) + int(m.group(3))) // 2
    y = (int(m.group(2)) + int(m.group(4))) // 2
    subprocess.run(A + ['shell', 'input', 'tap', str(x), str(y)])
    print('tap:', label, x, y)

def type_text(t):
    escaped = t.replace(' ', '%s')
    subprocess.run(A + ['shell', 'input', 'text', escaped])
    print('type:', t[:24])

def texts():
    xml = dump()
    return [m.group(1) for m in re.finditer(r'<node[^>]*text="([^"]*)"', xml)]

if __name__ == '__main__':
    action = sys.argv[1] if len(sys.argv) > 1 else 'session'
    if action == 'session':
        tap_label('＋ 新建会话')
        time.sleep(3)
        print('after-new-session:', [t for t in texts() if t][:12])
    elif action == 'task':
        tap_label('布置任务…')
        time.sleep(0.5)
        type_text('write a file hello.py that prints hello whale')
        time.sleep(0.5)
        subprocess.run(A + ['shell', 'input', 'keyevent', '4'])
        time.sleep(0.5)
        tap_label('发送')
        print('task sent')
    elif action == 'dump':
        print([t for t in texts() if t][:20])
