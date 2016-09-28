class Player {
	constructor(eventHandler, buffer) {
		this.startTime = 0;
		this.buffer = buffer || null;
		this.division;
		this.setIntervalId;
		this.tracks = [];
		this.tracksEnabled = []; // 0 disabled, 1 enabled
		this.tempo = 100;
		this.tick = 0;
		this.lastStatuses = [];
		this.lastTick = null;
		this.lastTicks = [];
		this.pointers = [];

		this.eventHandler = eventHandler;
	}

	// Only for NodeJS
	loadFile(path) {
		var fs = require('fs');
		this.buffer = fs.readFileSync(path);
		return this.fileLoaded();
	}

	loadArrayBuffer(arrayBuffer) {
		this.buffer = new Uint8Array(arrayBuffer);
		return this.fileLoaded();
	}

	loadDataUri(dataUri) {
		this.buffer = array;
		return this.fileLoaded();
	}

	fileLoaded() {
		if (!this.validate()) throw 'Invalid file; should start with MThd';
		this.getDivision().getTracks();
		return this;
	}

	// First four bytes should be MThd
	validate() {
		return Utils.bytesToLetters(this.buffer.slice(0, 4)) === 'MThd';
	}

	getLength() {
		this.buffer.slice(4,8).forEach(function(byte) {
			console.log(byte)
		})
		return this.buffer.slice(4, 8);
	}

	getFormat() {
		/*
		MIDI files come in 3 variations:
		Format 0 which contain a single track
		Format 1 which contain one or more simultaneous tracks 
		(ie all tracks are to be played simultaneously).
		Format 2 which contain one or more independant tracks 
		(ie each track is to be played independantly of the others).
		return Utils.bytesToNumber(this.buffer.slice(8, 10));
		*/

		return Utils.bytesToNumber(this.buffer.slice(8, 10));
	}

	getTrackCount() {
		return Utils.bytesToNumber(this.buffer.slice(10, 12));
	}

	// Parses out tracks and places them in this.tracks and initializes this.pointers
	getTracks() {
		this.buffer.forEach(function(byte, index) {
			if (Utils.bytesToLetters(this.buffer.slice(index, index + 4)) == 'MTrk') {
				var trackLength = Utils.bytesToNumber(this.buffer.slice(index + 4, index + 8));
				this.tracks.push(this.buffer.slice(index + 8, index + 8 + trackLength));
				this.pointers.push(0);
				this.lastTicks.push(0);
				this.tracksEnabled.push(1);
			}
		}, this);

		return this;
	}

	enableTrack(trackNumber) {
		this.tracksEnabled[trackNumber - 1] = 1;
		return this;
	}

	disableTrack(trackNumber) {
		this.tracksEnabled[trackNumber - 1] = 0;
		return this;
	}

	getDivision() {
		this.division = Utils.bytesToNumber(this.buffer.slice(12, 14));
		return this;
	}

	/**
	 * Handles event within a given track starting at specified index
	 * @param track
	 */
	handleEvent(trackIndex) {
		// Parse delta value
		var track = this.tracks[trackIndex];
		var pointer = this.pointers[trackIndex];
		var deltaByteCount = this.getDeltaByteCount(trackIndex);
		var delta = Utils.readVarInt(track.slice(pointer, pointer + deltaByteCount));
		var eventSig = track[pointer + deltaByteCount];

		if (this.pointers[trackIndex] < this.tracks[trackIndex].length && this.tick - this.lastTicks[trackIndex] >= delta) {
			var event = this.parseEvent(trackIndex, deltaByteCount);

			if (this.tracksEnabled[trackIndex] == 1) this.emitEvent(event);
			
			// Recursively call this function for each event ahead that has 0 delta time?
		}
	}

	play() {
		// Initialize
		this.startTime = (new Date).getTime();

		// Start play loop
		var me = this;
		this.setIntervalId = setInterval(function() {
			me.tick = me.getCurrentTick();
			
			// Which one's faster?

			for (var i = 0; i <= me.tracks.length - 1; i++) {
				//console.log(me.tick)
				// Handle next event
				if (me.endOfFile()) {
					clearInterval(me.setIntervalId);

				} else {
					me.handleEvent(i);
				}
			}
			/*
			me.tracks.forEach(function(track, index) {
				//console.log(me.tick)
				// Handle next event
				if (me.endOfTrack(index)) {
					clearInterval(me.setIntervalId);

				} else {
					me.handleEvent(index);
				}
			});	
			*/
			
		}, 1);

		return this;
	}

	stop() {
		clearInterval(this.setIntervalId);
		this.lastStatuses = [];
		this.lastTick = null;
		this.lastTicks = [];
		this.pointers = [];
	}

	endOfTrack(trackIndex) {
		var pointer = this.pointers[trackIndex];
		if (this.tracks[trackIndex][pointer + 1] == 0xff && this.tracks[trackIndex][pointer + 2] == 0x2f && this.tracks[trackIndex][pointer + 3] == 0x00) {
			return true;
		}

		return false;
	}

	endOfFile() {
		// Currently assume header chunk is strictly 14 bytes
		return 14 + this.tracks.length * 8 + this.pointers.reduce(function(a, b) {return a+b}, 0) == this.buffer.length;
	}

	getDeltaByteCount(trackIndex) {
		// Get byte count of delta VLV
		// http://www.ccarh.org/courses/253/handout/vlv/
		// If byte is greater or equal to 80h (128 decimal) then the next byte 
	    // is also part of the VLV,
	   	// else byte is the last byte in a VLV.
	   	var track = this.tracks[trackIndex];
	   	var pointer = this.pointers[trackIndex];
	   	var currentByte = track[pointer];
	   	var byteCount = 1;

		while (currentByte >= 128) {
			currentByte = track[pointer + byteCount];
			byteCount++;
		}

		return byteCount;
	}

	getCurrentTick() {
		return Math.round(((new Date).getTime() - this.startTime) / 1000 * (this.division * (this.tempo / 60)));
	}

	emitEvent(event) {
		if (typeof this.eventHandler === 'function') this.eventHandler(event);
	}

	// Parses event into JSON and advances pointer for the track
	parseEvent(trackIndex, deltaByteCount) {
		//console.log(this.tick);
		var track = this.tracks[trackIndex];
		var eventStartIndex = this.pointers[trackIndex] + deltaByteCount;
		var eventJson = {};
		eventJson.track = trackIndex + 1;
		eventJson.delta = Utils.readVarInt(track.slice(this.pointers[trackIndex], this.pointers[trackIndex] + deltaByteCount));
		this.lastTicks[trackIndex] = this.lastTicks[trackIndex] + eventJson.delta;

		//eventJson.raw = event;
		if (track[eventStartIndex] == 0xff) {
			// Meta Event

			// If this is a meta event we should emit the data and immediately move to the next event
			// otherwise if we let it run through the next cycle a slight delay will accumulate if multiple tracks
			// are being played simultaneously

			switch(track[eventStartIndex + 1]) {
				case 0x00: // Sequence Number
					eventJson.name = 'Sequence Number';
					break;
				case 0x01: // Text Event
					eventJson.name = 'Text Event';
					break;
				case 0x02: // Copyright Notice
					eventJson.name = 'Copyright Notice';
					break;
				case 0x03: // Sequence/Track Name
					eventJson.name = 'Sequence/Track Name';
					// Get vlv length
					var currentByte = this.pointers[trackIndex];
					var byteCount = 1;
					while (currentByte >= 128) {
						currentByte = track[this.pointers[trackIndex] + byteCount];
						byteCount++;
					}
					eventJson.vlv = byteCount;
					var length = Utils.readVarInt(track.slice(eventStartIndex + 2, eventStartIndex + 2 + byteCount));
					eventJson.stringLength = length;
					eventJson.string = Utils.bytesToLetters(track.slice(eventStartIndex + byteCount + 2, eventStartIndex + byteCount + length + 2));
					break;
				case 0x04: // Instrument Name
					eventJson.name = 'Instrument Name';
					break;
				case 0x05: // Lyric
					eventJson.name = 'Lyric';
					break;
				case 0x06: // Marker
					eventJson.name = 'Marker';
					break;
				case 0x07: // Cue Point
					eventJson.name = 'Cue Point';
					break;
				case 0x20: // MIDI Channel Prefix
					eventJson.name = 'MIDI Channel Prefix';
					break;
				case 0x2F: // End of Track
					eventJson.name = 'End of Track';
					break;
				case 0x51: // Set Tempo
					eventJson.name = 'Set Tempo';
					eventJson.data = Utils.bytesToNumber(track.slice(eventStartIndex + 3, eventStartIndex + 6));
					break;
				case 0x54: // SMTPE Offset
					eventJson.name = 'SMTPE Offset';
					break;
				case 0x58: // Time Signature
					eventJson.name = 'Time Signature';
					break;
				case 0x59: // Key Signature
					eventJson.name = 'Key Signature';
					break;
				case 0x7F: // Sequencer-Specific Meta-event
					eventJson.name = 'Sequencer-Specific Meta-event';
					break;
			}

			var length = track[this.pointers[trackIndex] + deltaByteCount + 2];
			// Some meta events will have vlv that needs to be handled

			this.pointers[trackIndex] += length + 4;

		} else {
			// Voice event
			if (track[eventStartIndex] < 0x80) {
				// Running status
				eventJson.running = true;
				eventJson.noteNumber = track[eventStartIndex + 1];
				eventJson.noteName = Constants.NOTES[track[eventStartIndex]];
				eventJson.velocity = track[eventStartIndex + 1];
				
				if (this.lastStatuses[trackIndex] <= 0x8f) {
					eventJson.name = 'Note off';

				} else if (this.lastStatuses[trackIndex] <= 0x9f) {
					eventJson.name = 'Note on';
				}

				this.pointers[trackIndex] += deltaByteCount + 2;

			} else {
				this.lastStatuses[trackIndex] = track[eventStartIndex];

				if (track[eventStartIndex] <= 0x8f) {
					// Note off
					eventJson.name = 'Note off';
					eventJson.noteNumber = track[eventStartIndex + 1];
					eventJson.noteName = Constants.NOTES[track[eventStartIndex + 1]];
					this.pointers[trackIndex] += deltaByteCount + 3;

				} else if (track[eventStartIndex] <= 0x9f) {
					// Note on
					eventJson.name = 'Note on';
					eventJson.noteNumber = track[eventStartIndex + 1];
					eventJson.noteName = Constants.NOTES[track[eventStartIndex + 1]];
					this.pointers[trackIndex] += deltaByteCount + 3;

				} else if (track[eventStartIndex] <= 0xaf) {
					// Polyphonic Key Pressure
					eventJson.name = 'Polyphonic Key Pressure';
					eventJson.note = Constants.NOTES[track[eventStartIndex + 1]];
					eventJson.pressure = event[2];
					this.pointers[trackIndex] += deltaByteCount + 3;

				} else if (track[eventStartIndex] <= 0xbf) {
					// Controller Change
					eventJson.name = 'Controller Change';
					eventJson.number = track[eventStartIndex + 1];
					eventJson.value = track[eventStartIndex + 2];
					this.pointers[trackIndex] += deltaByteCount + 3;

				} else if (track[eventStartIndex] <= 0xcf) {
					// Program Change
					eventJson.name = 'Program Change';
					this.pointers[trackIndex] += deltaByteCount + 2;

				} else if (track[eventStartIndex] <= 0xdf) {
					// Channel Key Pressure
					eventJson.name = 'Channel Key Pressure';
					this.pointers[trackIndex] += deltaByteCount + 2;

				} else if (track[eventStartIndex] <= 0xef) {
					// Pitch Bend
					eventJson.name = 'Pitch Bend';
					this.pointers[trackIndex] += deltaByteCount + 3;
				}
			}
		}

		return eventJson;
	}

}

exports.Player = Player;