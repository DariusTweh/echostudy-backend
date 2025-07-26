import axios from 'axios';

export async function fetchYoutubeSuggestions(topic) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  const query = encodeURIComponent(topic);
  const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=3&q=${query}&key=${apiKey}`;

  try {
    const response = await axios.get(url);
    const videos = response.data.items.map((item) => ({
      title: item.snippet.title,
      videoId: item.id.videoId,
      thumbnail: item.snippet.thumbnails.default.url,
      channel: item.snippet.channelTitle,
    }));

    return videos;
  } catch (err) {
    console.error('❌ YouTube fetch error:', err.message);
    return [];
  }
}
