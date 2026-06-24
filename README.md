# Photo Memory

Expo app for capturing photos, saving capture location, generating an AI
description with Gemini 2.5 Flash, and reopening saved photo history later.

## Features

- Capture a photo with `expo-image-picker`.
- Store photo metadata with `@react-native-async-storage/async-storage`.
- Copy captured image files into app document storage with `expo-file-system`.
- Save the device location at capture time with `expo-location`.
- Show the selected photo location on an in-app `react-native-maps` map.
- Show a Google Maps URL generated from the saved coordinates.
- Open the capture point in Google Maps.
- Generate a short Vietnamese image description using Gemini 2.5 Flash.
- Delete saved photos and their local files.

## Setup

The Gemini API key is read from `.env.local`:

```bash
EXPO_PUBLIC_GEMINI_API_KEY=your_key_here
```

Run the app:

```bash
npm install
npm start
```

For phone testing on the same Wi-Fi network:

```bash
npx expo start --lan --port 8081
```
