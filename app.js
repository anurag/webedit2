
const firebase = require('firebase');
var config = {
	apiKey: "AIzaSyCtsK9Nx0Fh7YzwZ8r7V2oXw_cB0XQG4z8",
	authDomain: "webedit-204210.firebaseapp.com",
	databaseURL: "https://webedit-204210.firebaseio.com",
	projectId: "webedit-204210",
	storageBucket: "webedit-204210.appspot.com",
	messagingSenderId: "1059738201826"
};
firebase.initializeApp(config);
const root = firebase.database().ref();
const projects = root.child('projects');

const fileupload = require('express-fileupload');
const express = require('express');
const favicon = require('express-favicon');
const randomstring = require('randomstring');
const cookieParser = require('cookie-parser');
const archiver = require('archiver');
const Storage = require('@google-cloud/storage');

const storage = new Storage({
	projectid: 'webedit-204210'
});
const bucket = storage.bucket('we.nerq.com');
const app = express();
const cookieToUid = firebase.database().ref().child('cookieToUid');
let g = {"cookieToUid": {}};
const PORT = process.env.PORT || 8080;

root.child('admin/admins').on('value', function(snapshot) {
	g.admins = snapshot.val();
	console.log(g.admins);
});

app.use(express.static('html'));
app.use(favicon(__dirname + '/html/images/favicon.jpg'));
app.get('/', (req, res) => {
	res.status(200).send('Minimal says, hello, world!').end();
});

// Start the server
app.listen(PORT, () => {
	console.log(`App listening on port ${PORT}`);
	console.log('Press Ctrl+C to quit.');
});

app.use(fileupload());
app.use(cookieParser());

app.post('/upload', function(req, res) {
	console.log(req);
	uploadfile(req);
});

app.use(function (req, res) {
	//console.log('cookies', g.cookieToUid)
	g.uid = g.cookieToUid[req.cookies.cookieId];
	//console.log('0', req.cookies.cookieId, g.uid);
	if (g.uid) {
		serve(req, res);
		return;
	}
	cookieToUid.once('value') 
	.then(function (snapshot) {
		snapshot.forEach(function (snap) {
			//console.log('A', snap.key, snap.val());
			g.cookieToUid[snap.key] = snap.val();	
		});
		g.uid = g.cookieToUid[req.cookies.cookieId];
		console.log('1', g.uid, g.cookieToUid);
		serve(req, res);
	});
});

function uploadfile(req) {
	//console.log(req.files.file, req.body);
	let uploadedfile = req.files.file.data
	let uid = req.body.uid;
	let projectname = req.body.projectname;
	let filename = req.files.file.name;
	let fileroute = '/' + uid + '/' + projectname + '/' + filename;
	console.log(fileroute)
	let file = bucket.file(fileroute);
	let gcstream = file.createWriteStream();
	gcstream.write(uploadedfile)
	gcstream.on('error', (err) => {
		console.log(err)
	});
	gcstream.on('finish', () => {
		console.log(filename)
	});
	gcstream.end();
}

function nametoid(ref, uid, name) {
	//console.log(uid, name);
	return ref.child(uid).orderByChild('name').equalTo(name).once('value')
	.then(function (snapshot) {
		let key;
		snapshot.forEach(function (snap) {
			if (snap.val().settings.archived) return;
			//console.log('key', snap.key)
			key = snap.key;
		});
		return key;
	});
}

function readable(ref, uid, project, file) {
	console.log('2', g.uid, uid, project);
	if (!project && (uid == g.uid || g.admins[g.uid])) return Promise.resolve(true);
	return nametoid(ref, uid, project)
	.then(function (projectId) {
		//console.log('projectId', projectId)
		if (!projectId && !g.admins[g.uid]) return false;
		if (g.admins[g.uid]) return true;
		return ref.child(uid).child(projectId).once('value')
		.then(function (snapshot) {
			console.log("60", snapshot.val().settings.ispublic, uid == g.uid);
			return snapshot.val().settings.ispublic || uid == g.uid || g.admins[g.uid];
		});
	});
}

function download(res, uid, projectid, projectname) {
	console.log(uid, projectid);
	var archive = archiver('zip');
	var zippedFilename;
	if (projectname) {
		zippedFilename = projectname + '.zip';
	} else zippedFilename = uid + '.zip';
	var header = {
		"Content-Type": "application/x-zip",
		"Pragma": "public",
		"Expires": "0",
		"Cache-Control": "private, must-revalidate, post-check=0, pre-check=0",
		"Content-disposition": 'attachment; filename="' + zippedFilename + '"',
		"Transfer-Encoding": "chunked",
		"Content-Transfer-Encoding": "binary"
	};
	res.writeHead(200, header);
	archive.store = true;  // don't compress the archive
	archive.pipe(res);
	if (projectid) {
		projects.child(uid).child(projectid).once('value', function(snapshot) {
			archive.append('', {name: snapshot.val().name + '/'})
			archive.append(snapshot.val().contents, {name: '/' + snapshot.val().name + '/' + snapshot.val().name});	
			for (let file in snapshot.val().files) {
				console.log(snapshot.val().files[file].name);
				archive.append(snapshot.val().files[file].contents, {name: '/' + snapshot.val().name + '/' + snapshot.val().files[file].name});	
			}
			archive.finalize();
		});
	} else {
		projects.child(uid).once('value', function(snapshot) {
			snapshot.forEach(function(snap) {
				if (snap.val().contents && snap.val().settings.archived != true) {
					archive.append('', {name: snap.val().name + '/'})
					archive.append(snap.val().contents, {name: '/' + snap.val().name + '/' + snap.val().name});	
					for (let file in snap.val().files) {
						console.log(snap.val().files[file].name);
						archive.append(snap.val().files[file].contents, {name: '/' + snap.val().name + '/' + snap.val().files[file].name});	
					}
				}
			});
			archive.finalize();			
		});
	}
}

function nametoref(ref, uid, name) {
	//console.log(uid, name);
	return ref.child(uid).orderByChild('name').equalTo(name).once('value')
	.then(function (snapshot) {
		let key;
		snapshot.forEach(function (snap) {
			if (snap.val().settings) {
				if (snap.val().settings.archived) return;
			}
			console.log('key', snap.key)
			key = snap.ref;
		});
		if (!key) {
			throw 'ref not found';
		}
		return key;
	});
}		

function serve(req, res) {
	let query = req.query;
	let [host, uid, projectname, filename] = req.path.split('/')
	console.log(projectname);
	if (!filename) {
		console.log('URL info:', host, uid, projectname, filename, query.run);
	}
	if (projectname.match(/^\./) && projectname != '.settings') {
		[filename, projectname] = [projectname]
	}

	if (!g.uid) {
		let cookieId = randomstring.generate();
		console.log('cookie, uid', g.uid, cookieId);
		res.cookie('cookieId', cookieId);	
	}
	
	readable(projects, uid, projectname, filename)
	.then(function (readable) {
		//console.log('readable', readable, filename);
		if (!readable) {
			res.status(401);
			res.send('Access denied');
			return;
		} else {
			if (query.run == 'crashed') {
				projects.child('0GZ6h7paIPSfwN6kvMqxv85p9XX2').child('-LEboYpzmQHHIb9ABL73').child('files' ).child('-LEbovEq_RODq0hVUfpP').once('value', function(snapshot) {
					//console.log('toc');
					res.send(snapshot.val().contents);
				});				
			} else if (filename == '.files') {
				console.log(projectname, filename);
				if (projectname) {
					nametoref(projects, uid, projectname)
					.then(function(projectref) {
						projectref.child('files').once('value', function (snapshot) {
							let files = snapshot.val();
							let results = [];
							Object.values(files).forEach(function(file) {
								//console.log(snapshot.val());
								delete file.contents;
								console.log('file', file)
								results.push(file);							
							});
							res.send(JSON.stringify(results));
						});
					});
				} else {
					console.log('.files');
					projects.child(uid).orderByChild('lastchange').once('value', function (snapshot) {
						let allprojects = [];
						snapshot.forEach(function (snap) {
							if (snap.val().name) {
								allprojects.unshift({'name': snap.val().name, 'lastchange': snap.val().lastchange, 'archived': snap.val().settings.archived});
							}
						});
						res.send(JSON.stringify(allprojects))
					});
				}
			} else if (!projectname) {
				if (query.run == 'download') {
					download(res, uid)					
				} else {
					console.log('TABLE OF CONTENTS');
					projects.child('0GZ6h7paIPSfwN6kvMqxv85p9XX2').child('-LEboYpzmQHHIb9ABL73').child('files' ).child('-LFVYbMm1BjtqOW6vJpY').once('value', function(snapshot) {
						//console.log('toc');
						res.send(snapshot.val().contents);
					});
				}
			} else if (!filename) {
				if (query.run == 'download') {
					console.log('DOWNLOAD PROJECT');
					nametoid(projects, uid, projectname)
					.then(function (nametoid) {
						download(res, uid, nametoid, projectname)
					});
				} else {
					console.log('RUN OR EDIT');
					projects.child(uid).orderByChild('name').equalTo(projectname).once('value', function (snapshot) {
						if (snapshot.val()) {
							snapshot.forEach(function (snap) {
								if (!snap.val().settings.archived) {
									if (query.run == 'edit' || query.run == 'editor') {
										res.sendFile('editor.html', {root: __dirname + "/html/"});			
									} else if (query.run == 'viewer') {
										projects.child('global').child('-LFApck9n3U1YdCYWKEA').child('files' ).orderByChild('name').equalTo('viewer.html').once('value', function (vsnapshot) {
											vsnapshot.forEach(function (vsnap) {
												res.send(vsnap.val().contents)
											});
										});				
									} else {
										res.send(snap.val().contents);
									}
								}
							});
						}
						return;
					});
				}
			} else if (filename) {
				console.log('DEPENDANCY');
				nametoref(projects, uid, projectname)
				.then(function(projectref) {
					nametoref(projectref, 'files', filename)
					.then(function(fileref) {
						fileref.once('value', function (snapshot) {
							let type = snapshot.val().name.split('.')[1]
							if (type == 'js') {type = 'javascript'}
							res.set('content-type', 'text/'+type);
							res.send(snapshot.val().contents);							
						});
					})
					.catch(function(err) {
						let file = bucket.file('/' + uid + '/' + projectname + '/' + filename);
						console.log('test');
						let filereadstream = file.createReadStream();
						console.log('test2');
						filereadstream.pipe(res);
						filereadstream.on('error', function(err2) {
							res.status(404)
							res.send('file not found')							
						});
					});
				});
			} else {
				res.status(404)
				res.send('Not found')			
			}
		}
	});
}

















