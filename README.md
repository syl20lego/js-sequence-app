# Sequence Diagram Editor

Vibe coding application created with Claude Sonnet 4

A web application for creating and editing sequence diagrams using js-sequence-diagrams library.

Inspired by [js-sequence-diagrams](https://bramp.github.io/js-sequence-diagrams/)

## Features

- **Text Editor**: Edit sequence diagram syntax in a convenient text area
- **Live Preview**: Render diagrams in real-time as SVG
- **File Management**:
  - Load diagram text files from your computer
  - Save diagram text to files on the server
  - List and load previously saved diagrams
- **Image Export**: Save rendered diagrams as PNG images

## Diagram Syntax

The application uses js-sequence-diagrams syntax. Example:

```
Title: Example Diagram

Alice->Bob: Hello Bob, how are you?
Note right of Bob: Bob thinks
Bob-->Alice: I am good thanks!
```

For more syntax examples, visit: [js-sequence-diagrams](https://bramp.github.io/js-sequence-diagrams/)

## File Structure

- `public/` - Frontend files
  - `index.html` - Main application page
  - `styles.css` - Application styling
  - `app.js` - Client-side JavaScript
- `diagrams/` - Saved diagram text files (created automatically)
- `images/` - Saved PNG images (created automatically)
