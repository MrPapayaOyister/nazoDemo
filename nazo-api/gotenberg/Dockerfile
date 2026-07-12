# Gotenberg 8 with Arabic fonts for correct RTL / Arabic PDF rendering via the
# LibreOffice route. Base image is arm64-friendly (gotenberg publishes multi-arch).
FROM gotenberg/gotenberg:8

USER root

# Install Arabic-capable fonts. fonts-noto-core covers Naskh/Sans Arabic coverage;
# fonts-hosny-amiri is the classic Amiri Naskh face used for formal letters.
# Fallback (if a mirror lacks these packages on the DGX): download Amiri + Noto
# Naskh Arabic manually into /usr/share/fonts/truetype/nazo/ and re-run fc-cache.
#   mkdir -p /usr/share/fonts/truetype/nazo
#   curl -L -o /usr/share/fonts/truetype/nazo/Amiri-Regular.ttf \
#     https://github.com/aliftype/amiri/releases/latest/download/Amiri-Regular.ttf
#   fc-cache -f
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        fonts-noto-core \
        fonts-hosny-amiri \
    && fc-cache -f \
    && rm -rf /var/lib/apt/lists/*

USER gotenberg
