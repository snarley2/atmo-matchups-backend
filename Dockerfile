FROM node:24-bookworm

# Install Xvfb and the Linux libraries Chrome needs
RUN apt-get update && apt-get install -y \
    xvfb \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    xdg-utils \
    && rm -rf /var/lib/apt/lists/*

# App directory
WORKDIR /app

# Install Node dependencies first for better Docker caching
COPY package*.json ./

RUN npm install

# Copy backend source
COPY . .

# Install the Chrome version expected by Puppeteer
RUN npx puppeteer browsers install chrome

# Virtual display used by headful Chrome
ENV DISPLAY=:99

# Start a virtual X display, then start the ATMO backend.
# This allows Puppeteer to use headless:false on Render.
CMD ["sh", "-c", "Xvfb :99 -screen 0 1920x1080x24 -ac +extension RANDR & exec npm run server"]