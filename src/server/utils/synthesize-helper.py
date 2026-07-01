import sys
import pyttsx3

def synthesize(text, out_path):
    try:
        engine = pyttsx3.init()
        # Set speaking rate for a natural speed
        engine.setProperty('rate', 165)
        
        # Check voices list and try to use a good voice index
        voices = engine.getProperty('voices')
        if len(voices) > 0:
            # We can use the first voice by default, or second voice if available
            engine.setProperty('voice', voices[0].id)
            
        engine.save_to_file(text, out_path)
        engine.runAndWait()
    except Exception as e:
        sys.stderr.write(str(e))
        sys.exit(1)

if __name__ == "__main__":
    if len(sys.argv) < 3:
        sys.exit(1)
    text = sys.argv[1]
    out_path = sys.argv[2]
    synthesize(text, out_path)
