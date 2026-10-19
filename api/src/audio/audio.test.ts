import {describe, expect, it} from 'vitest'

import {deliveryFileName, outputKey} from './jobs'
import {toTagData, type TrackTagData} from './metadata'
import {parseProbe} from './probe'
import {deliveryArgs, id3Tags, previewArgs, previewWindow} from './transcode'
import {checkProbe} from './verify'

const tags: TrackTagData = {
  trackId: 't1', releaseId: 'r1', providerId: 'p1', title: 'Night Drive', artist: 'John Blaze', albumArtist: 'John Blaze',
  album: 'Woodward EP', trackNumber: 2, trackTotal: 5, discNumber: 1, year: '2026', genre: 'House', label: null,
  copyright: null, isrc: 'QTA3L2600001', explicit: false, artwork: null,
}
const probe = {container: 'wav', codec: 'pcm_s24le', durationMs: 200_000, bitRate: null, sampleRate: 96_000, bitDepth: 24, channels: 2, tags: {}, hasCoverArt: false}

describe('tag mapping', () => {
  it('credits featured artists, adds versions to titles and falls back to the copyright year', () => {
    const data = toTagData({
      track_id: 't', release_id: 'r', provider_profile_id: 'p', title: 'Night Drive', version_title: 'Extended Mix', track_number: 3, disc_number: 1,
      explicit: true, track_genre: null, release_title: 'Woodward', release_version_title: null, release_genre: 'House', label_name: ' MeJay ',
      original_release_date: null, copyright_year: 2025, copyright_holder: 'John Blaze', isrc: null, track_artist: 'John Blaze',
      release_artist: 'John Blaze', featured_artists: ['Guest One', 'John Blaze', 'Guest Two'], track_total: 4, artwork_key: null, artwork_mime: null,
    })
    expect(data).toMatchObject({title: 'Night Drive (Extended Mix)', artist: 'John Blaze feat. Guest One & Guest Two', year: '2025', genre: 'House', label: 'MeJay', copyright: '2025 John Blaze', trackTotal: 4})
  })

  it('writes only filled tags, including the ISRC frame, with no line breaks', () => {
    const written = Object.fromEntries(id3Tags({...tags, genre: 'House\nMusic'}))
    expect(written).toMatchObject({title: 'Night Drive', track: '2/5', TSRC: 'QTA3L2600001', genre: 'House Music'})
    expect(written).not.toHaveProperty('publisher')
  })
})

describe('ffmpeg arguments', () => {
  it('encodes 320 kbps, drops source tags, resamples above 48 kHz and attaches the cover', () => {
    const args = deliveryArgs({sourcePath: '/s', coverPath: '/c.jpg', outputPath: '/o.mp3', tags, probe})
    expect(args).toEqual(expect.arrayContaining(['-b:a', '320k', '-map_metadata', '-1', '-ar', '48000', '-disposition:v:0', 'attached_pic', '-id3v2_version', '3']))
    expect(deliveryArgs({sourcePath: '/s', coverPath: null, outputPath: '/o.mp3', tags, probe: {...probe, sampleRate: 44_100}})).not.toContain('-ar')
  })

  it('takes a 30 s preview from 0:30 on full songs and from the top on short ones', () => {
    expect(previewWindow(200_000)).toEqual({startSeconds: 30, lengthSeconds: 30})
    expect(previewWindow(40_000)).toEqual({startSeconds: 0, lengthSeconds: 30})
    expect(previewWindow(12_000)).toEqual({startSeconds: 0, lengthSeconds: 12})
    expect(previewArgs({sourcePath: '/s', coverPath: null, outputPath: '/p.mp3', tags, probe})).toEqual(expect.arrayContaining(['-ss', '30', '-t', '30', '-b:a', '128k']))
  })
})

describe('probe parsing and verification', () => {
  const raw = JSON.stringify({
    streams: [
      {codec_type: 'audio', codec_name: 'mp3', sample_rate: '48000', channels: 2, bit_rate: '320000', tags: {}},
      {codec_type: 'video', codec_name: 'mjpeg', disposition: {attached_pic: 1}},
    ],
    format: {format_name: 'mp3', duration: '200.02', tags: {TITLE: 'Night Drive', artist: 'John Blaze', album: 'Woodward EP'}},
  })

  it('reads facts, lower-cases tags and spots embedded art', () => {
    expect(parseProbe(raw)).toMatchObject({container: 'mp3', codec: 'mp3', durationMs: 200_020, sampleRate: 48_000, bitRate: 320_000, hasCoverArt: true, tags: {title: 'Night Drive'}})
  })

  it('rejects files with no audio or no duration', () => {
    expect(() => parseProbe(JSON.stringify({streams: [{codec_type: 'video', codec_name: 'png'}], format: {}}))).toThrow('No audio stream')
    expect(() => parseProbe('not json')).toThrow('unreadable')
  })

  it('flags wrong duration, tags or a missing cover', () => {
    const parsed = parseProbe(raw)
    const expected = {durationMs: 200_000, title: 'Night Drive', artist: 'John Blaze', album: 'Woodward EP', coverArt: true}
    expect(checkProbe(parsed, expected)).toEqual([])
    expect(checkProbe(parsed, {...expected, durationMs: 150_000})).toEqual([expect.stringContaining('duration')])
    expect(checkProbe({...parsed, hasCoverArt: false, tags: {...parsed.tags, artist: 'Someone'}}, expected)).toHaveLength(2)
  })
})

describe('output naming', () => {
  it('keeps outputs inside the marketplace prefix and filenames clean', () => {
    expect(outputKey({id: 'j1', provider_profile_id: 'p1', track_id: 't1'}, 'audio_preview')).toBe('mejay-artist/p1/audio_preview/t1/j1.mp3')
    expect(deliveryFileName('AC/DC', 'What? "Now"')).toBe('AC DC - What Now.mp3')
    expect(deliveryFileName('', '', ' (Preview)')).toBe('Unknown Artist - Untitled (Preview).mp3')
  })
})
