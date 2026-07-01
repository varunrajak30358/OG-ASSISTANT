import pyautogui
import sys
import time
import socket
import json

# Disable fail-safe to prevent termination if mouse hits a corner
pyautogui.FAILSAFE = False

def run_action(action, x, y, text=""):
    pyautogui.moveTo(x, y, duration=0.1)
    if action == "click":
        pyautogui.click()
    elif action == "double_click":
        pyautogui.doubleClick()
    elif action == "right_click":
        pyautogui.rightClick()
    elif action == "hover":
        pass
    elif action == "type":
        pyautogui.click()
        time.sleep(0.1)
        pyautogui.write(text, interval=0.01)

def start_daemon(port=9993):
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    # Allow port reuse
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        server.bind(('127.0.0.1', port))
    except Exception as e:
        print(f"error_bind:{str(e)}")
        sys.stdout.flush()
        sys.exit(1)

    server.listen(1)
    print(f"daemon_ready_on_port:{port}")
    sys.stdout.flush()
    
    while True:
        try:
            conn, addr = server.accept()
            data = conn.recv(2048).decode('utf-8')
            if not data:
                continue
            req = json.loads(data)
            action = req.get("action", "hover").lower()
            x = int(req.get("x", 0))
            y = int(req.get("y", 0))
            text = req.get("text", "")
            
            run_action(action, x, y, text)
            conn.sendall(b"done\n")
        except Exception as e:
            try:
                conn.sendall(f"error:{str(e)}\n".encode('utf-8'))
            except:
                pass
        finally:
            try:
                conn.close()
            except:
                pass

def main():
    if len(sys.argv) > 1 and sys.argv[1] == "--daemon":
        port = 9993
        if len(sys.argv) > 2:
            try:
                port = int(sys.argv[2])
            except:
                pass
        start_daemon(port)
        return

    if len(sys.argv) < 4:
        print("Usage: click-helper.py <action> <x> <y> [text]")
        print("Usage: click-helper.py --daemon [port]")
        sys.exit(1)

    action = sys.argv[1].lower()
    x = int(sys.argv[2])
    y = int(sys.argv[3])
    text = sys.argv[4] if len(sys.argv) > 4 else ""

    run_action(action, x, y, text)
    print("done")

if __name__ == "__main__":
    main()
