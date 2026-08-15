#!/bin/bash
# SPEC: 实机驱动助手：向聚焦输入框输入文本（ASCII 安全）
set -e
TEXT="${1:?需要文本参数}"
adb shell input text "$TEXT"
