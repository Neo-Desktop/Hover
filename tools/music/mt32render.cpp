// Plays a list of timed MIDI messages (mt32convert.py) on Munt's MT-32 emulation and writes a
// 32 kHz 16-bit stereo WAV.  mt32render <control.rom> <pcm.rom> <events.txt> <out.wav>
#include "mt32emu.h"
#include <cstdio>
#include <cstdint>
#include <vector>
#include <string>

using namespace MT32Emu;

static void put32(FILE *f, uint32_t v) { fwrite(&v, 4, 1, f); }
static void put16(FILE *f, uint16_t v) { fwrite(&v, 2, 1, f); }

int main(int argc, char **argv) {
    if (argc < 5) { fprintf(stderr, "usage\n"); return 2; }
    FileStream controlFile, pcmFile;
    if (!controlFile.open(argv[1]) || !pcmFile.open(argv[2])) { fprintf(stderr, "can't open the ROMs\n"); return 1; }
    const ROMImage *control = ROMImage::makeROMImage(&controlFile);
    const ROMImage *pcm = ROMImage::makeROMImage(&pcmFile);
    if (!control || !pcm || !control->getROMInfo() || !pcm->getROMInfo()) { fprintf(stderr, "unknown ROMs\n"); return 1; }
    fprintf(stderr, "ROMs: %s, %s\n", control->getROMInfo()->description, pcm->getROMInfo()->description);
    Synth synth;
    if (!synth.open(*control, *pcm)) { fprintf(stderr, "synth didn't open\n"); return 1; }
    uint32_t rate = synth.getStereoOutputSampleRate();

    FILE *in = fopen(argv[3], "r");
    std::vector<Bit16s> out;
    uint32_t rendered = 0;
    auto renderTo = [&](uint32_t frame) {
        while (rendered < frame) {
            uint32_t n = frame - rendered;
            if (n > 4096) n = 4096;
            size_t at = out.size();
            out.resize(at + n * 2);
            synth.render(&out[at], n);
            rendered += n;
        }
    };
    unsigned long frame;
    char hex[64];
    while (fscanf(in, "%lu %63s", &frame, hex) == 2) {
        renderTo((uint32_t)(frame * (double)rate / 32000));
        uint32_t msg = 0;
        std::string h(hex);
        for (size_t i = 0; i + 1 < h.size(); i += 2) {
            msg |= (uint32_t)std::stoul(h.substr(i, 2), nullptr, 16) << (4 * i);
        }
        synth.playMsgNow(msg);
    }
    fclose(in);
    renderTo(rendered + rate * 3); // let the last notes and the reverb ring out
    synth.close();

    FILE *f = fopen(argv[4], "wb");
    uint32_t bytes = out.size() * 2;
    fwrite("RIFF", 1, 4, f); put32(f, 36 + bytes); fwrite("WAVEfmt ", 1, 8, f);
    put32(f, 16); put16(f, 1); put16(f, 2); put32(f, rate); put32(f, rate * 4); put16(f, 4); put16(f, 16);
    fwrite("data", 1, 4, f); put32(f, bytes); fwrite(out.data(), 2, out.size(), f); fclose(f);
    fprintf(stderr, "%s: %.1f s at %u Hz\n", argv[4], out.size() / 2.0 / rate, rate);
    return 0;
}
