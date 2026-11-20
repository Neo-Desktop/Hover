#!/bin/bash
# Records the 1995 game's three songs (sounds/Retro/music/MUSIC1-3.mid) with a MIDI synthesizer, for
# classic mode's Options > Sounds > Music Played On, and adds the set to sounds/Retro/music/sets.json.
#
#   tools/render-music.sh <set> <sound bank>          a SoundFont (.sf2) or DLS bank (.dls), with FluidSynth
#   tools/render-music.sh soundblaster --fm           Sound Blaster 16: Yamaha OPL3 FM (Nuked OPL3)
#   tools/render-music.sh ess --fm                    ESS AudioDrive: ESS FM chip (ESFMu)
#   tools/render-music.sh mt32 --mt32 <rom folder>    Roland MT-32 (Munt; needs your MT-32 ROMs)
#
# Sets the game knows: windows (Microsoft GS Wavetable: C:\Windows\System32\drivers\gm.dls),
# soundblaster, ess, mt32, sc88. Run it from the project folder, in WSL, Linux or macOS.
#
# Needs ffmpeg and python3, and for each kind of set:
#   - a bank: fluidsynth 2.4 or later (it reads .dls banks; the official Windows build works too:
#     set FLUIDSYNTH to its fluidsynth.exe);
#   - --fm: adlrender (tools/music/adlrender.cpp built with libADLMIDI, which has both chip
#     emulators and the FM instruments of Windows 9x's FM driver, its bank 58; set ADLRENDER);
#   - --mt32: mt32render (tools/music/mt32render.cpp built with Munt's libmt32emu; set MT32RENDER).
#     The MT-32 has no General MIDI: tools/music/mt32convert.py first moves the song's 8 busiest
#     parts to the MT-32's channels and translates instruments, pan and pitch bend.
# Building them is described in the README ("Music recordings").
#
# Each recording is made as loud as the others (-16.6 LUFS), the fading tail after the last note is
# cut so the song loops without a pause, and it is saved as .m4a and .ogg in sounds/Retro/music/<set>/.
set -euo pipefail

set_name="${1:?usage: tools/render-music.sh <set> <bank.sf2|bank.dls> | soundblaster|ess --fm | mt32 --mt32 <rom folder>}"
music=sounds/Retro/music
case "$set_name" in
    windows|soundblaster|ess|mt32|sc88) ;;
    *) echo "unknown set '$set_name' (windows, soundblaster, ess, mt32, sc88)" >&2; exit 1 ;;
esac
[ -f "$music/MUSIC1.mid" ] || { echo "run this from the project folder" >&2; exit 1; }

fluidsynth="${FLUIDSYNTH:-fluidsynth}"
adlrender="${ADLRENDER:-adlrender}"
mt32render="${MT32RENDER:-mt32render}"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir -p "$music/$set_name"

for n in 1 2 3; do
    raw="$work/raw$n.wav"
    case "${2:-}" in
        --mt32)
            roms="${3:?the folder with the MT-32 ROMs}"
            python3 tools/music/mt32convert.py "$music/MUSIC$n.mid" "$work/events$n.txt"
            "$mt32render" "$roms"/*ctrl*.rom "$roms"/*pcm*.rom "$work/events$n.txt" "$raw"
            ;;
        --fm)
            # bank 58 = Windows 9x FM instruments, volume model 9 = Windows 9x generic FM driver,
            # one chip; emulator 0 = Nuked OPL3 (Sound Blaster 16), 5 = ESFMu (ESS AudioDrive).
            emulator=0
            [ "$set_name" = ess ] && emulator=5
            "$adlrender" "$music/MUSIC$n.mid" "$raw" 58 "$emulator" 9 1
            ;;
        *)
            "$fluidsynth" -ni -q -g 0.6 -r 44100 -F "$raw" "${2:?the sound bank}" "$music/MUSIC$n.mid"
            ;;
    esac
    loudness=$(ffmpeg -hide_banner -nostats -i "$raw" -af ebur128 -f null - 2>&1 | grep -E '^\s+I:' | tail -1 | awk '{print $2}')
    gain=$(python3 -c "print(-16.6 - ($loudness))")
    ffmpeg -hide_banner -loglevel error -y -i "$raw" -af "volume=${gain}dB,alimiter=limit=0.95:level=disabled,silenceremove=start_periods=1:start_threshold=-55dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse" "$work/trim.wav"
    length=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$work/trim.wav")
    fade=$(python3 -c "print(max(0, $length - 0.04))")
    ffmpeg -hide_banner -loglevel error -y -i "$work/trim.wav" -af "afade=t=out:st=$fade:d=0.04" "$work/done.wav"
    ffmpeg -hide_banner -loglevel error -y -i "$work/done.wav" -c:a aac -b:a 128k -ar 44100 -ac 2 -movflags +faststart "$music/$set_name/MUSIC$n.m4a"
    ffmpeg -hide_banner -loglevel error -y -i "$work/done.wav" -c:a libvorbis -q:a 4 -ar 44100 -ac 2 "$music/$set_name/MUSIC$n.ogg"
    echo "$set_name MUSIC$n: $loudness LUFS, ${gain} dB, ${length} s"
done

python3 - "$music/sets.json" "$set_name" <<'EOF'
import json, sys
path, name = sys.argv[1], sys.argv[2]
with open(path) as f:
    data = json.load(f)
if name not in data["recorded"]:
    data["recorded"].append(name)
with open(path, "w") as f:
    json.dump(data, f, indent=4)
    f.write("\n")
print("added", name, "to", path)
EOF
