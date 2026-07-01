import sys
import speech_recognition as sr

def transcribe(wav_path):
    r = sr.Recognizer()
    try:
        with sr.AudioFile(wav_path) as source:
            audio = r.record(source)
        # Try transcribing as English first
        try:
            text = r.recognize_google(audio, language="en-US")
            if text:
                return text
        except Exception:
            pass
            
        # Fallback to Hindi transcription
        try:
            text = r.recognize_google(audio, language="hi-IN")
            return text
        except Exception:
            pass
            
        return ""
    except Exception as e:
        return ""

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("")
        sys.exit(0)
    print(transcribe(sys.argv[1]))
