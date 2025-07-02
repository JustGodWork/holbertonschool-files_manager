import mongo from 'mongodb';

class DBClient {
  constructor() {
    const host = process.env.DB_HOST || 'localhost';
    const port = process.env.DB_PORT || 27017;
    const database = process.env.DB_DATABASE || 'files_manager';
    const url = `mongodb://${host}:${port}`;
    mongo(url).then((client) => {
      this.client = client;
      this.client.connect().then(() => {
        this.db = this.client.db(database);
      }).catch((err) => {
        console.error(err);
      });
    }).catch((err) => {
      console.error(err);
    });
  }

  isAlive() {
    return this.client ? this.client.isConnected() : false;
  }

  nbUsers() {
    return this.isAlive() ? this.db.collection('users').countDocuments() : 0;
  }

  nbFiles() {
    return this.isAlive() ? this.db.collection('files').countDocuments() : 0;
  }
}

const dbClient = new DBClient();
export default dbClient;
