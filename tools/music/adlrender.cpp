// Renders a MIDI file with libADLMIDI to a 44.1 kHz 16-bit stereo WAV.
// adlrender <in.mid> <out.wav> <bank> <emulator> <volume model> <chips>
#include <adlmidi.h>
#include <cstdio>
#include <cstdlib>
#include <cstdint>
#include <vector>

static void put32(FILE *f, uint32_t v) { fwrite(&v, 4, 1, f); }
static void put16(FILE *f, uint16_t v) { fwrite(&v, 2, 1, f); }

int main(int argc, char **argv) {
    if (argc < 7) { fprintf(stderr, "usage\n"); return 2; }
    ADL_MIDIPlayer *p = adl_init(44100);
    if (!p) return 1;
    if (adl_switchEmulator(p, atoi(argv[4])) < 0) { fprintf(stderr, "emulator: %s\n", adl_errorInfo(p)); return 1; }
    if (adl_setNumChips(p, atoi(argv[6])) < 0) { fprintf(stderr, "chips: %s\n", adl_errorInfo(p)); return 1; }
    if (adl_setBank(p, atoi(argv[3])) < 0) { fprintf(stderr, "bank: %s\n", adl_errorInfo(p)); return 1; }
    adl_setVolumeRangeModel(p, atoi(argv[5]));
    adl_setLoopEnabled(p, 0);
    if (adl_openFile(p, argv[1]) < 0) { fprintf(stderr, "midi: %s\n", adl_errorInfo(p)); return 1; }
    std::vector<short> all;
    short buf[8192];
    for (;;) {
        int n = adl_play(p, 8192, buf);
        if (n <= 0) break;
        all.insert(all.end(), buf, buf + n);
    }
    for (int i = 0; i < 44100 * 2 * 2; i++) all.push_back(0); // let the last notes ring out
    FILE *f = fopen(argv[2], "wb");
    uint32_t bytes = all.size() * 2;
    fwrite("RIFF", 1, 4, f); put32(f, 36 + bytes); fwrite("WAVEfmt ", 1, 8, f);
    put32(f, 16); put16(f, 1); put16(f, 2); put32(f, 44100); put32(f, 44100 * 4); put16(f, 4); put16(f, 16);
    fwrite("data", 1, 4, f); put32(f, bytes); fwrite(all.data(), 2, all.size(), f); fclose(f);
    fprintf(stderr, "%s: %.1f s, emulator %s\n", argv[2], all.size() / 2 / 44100.0, adl_chipEmulatorName(p));
    adl_close(p);
    return 0;
}
