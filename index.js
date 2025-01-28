require("dotenv").config();
const express = require("express");
const app = express();
const cors = require("cors");
const jwt = require("jsonwebtoken");
const { createPayment, executePayment, queryPayment, searchTransaction, refundTransaction } = require('bkash-payment')
const port = 5000 || process.env.PORT;
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const uri = process.env.MONGODB_URI;
app.use(express.json());
app.use(
  cors({
    origin: ["http://localhost:5173", "https://nin-supply.vercel.app"],
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

const bkashConfig = {
  base_url : process.env.BKASH_BASE_URL,
  username: process.env.BKASH_USERNAME,
  password: process.env.BKASH_PASSWORD,
  app_key: process.env.BKASH_APP_KEY,
  app_secret: process.env.BKASH_APP_SECRET,
 }



// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    // TODO: Delete 31 Number Line
    // await client.connect();

    // Create a database and collection
    const usersCollection = client.db("NiNSupply").collection("users");
    const productsCollection = client.db("NiNSupply").collection("products");
    const categoryCollection = client.db("NiNSupply").collection("category");
    const cartsCollection = client.db("NiNSupply").collection("carts");
    const orderCollection = client.db("NinSupply").collection("orders");

    // JWT
    app.post("/jwt", async (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "1h",
      });
      res.send({ token });
    });

    // Verify Token
    const verifyToken = (req, res, next) => {
      if (!req.headers.authorization) {
        return res.status(401).send({ message: "unauthorized access" });
      }
      const token = req.headers.authorization.split(" ")[1];
      jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
        if (err) {
          return res.status(401).send({ message: "unauthorized access" });
        }
        req.decoded = decoded;
        next();
      });
    };

    // Verify Admin
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email };
      const user = await usersCollection.findOne(query);
      const isAdmin = user?.role === "admin";
      if (!isAdmin) {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };

    // User Related api
    app.post("/createUser", async (req, res) => {
      const user = req.body;
      const query = { email: user.email };
      const existingUser = await usersCollection.findOne(query);
      if (existingUser) {
        return res.send({ message: "user already exists", insertedId: null });
      }
      const result = await usersCollection.insertOne(user);
      res.send(result);
    });

    app.get("/users/:email", async (req, res) => {
      const email = req.params.email;
      const query = { email: email };
      const result = await usersCollection.findOne(query);
      res.send(result);
    });

    app.get("/allUsers", verifyToken, verifyAdmin, async (req, res) => {
      const result = await usersCollection.find().toArray();
      res.send(result);
    });

    // Product Related api
    app.post("/createProduct", verifyToken, verifyAdmin, async (req, res) => {
      const product = req.body;
      const result = await productsCollection.insertOne(product);
      res.send(result);
    });

    app.get("/products", async (req, res) => {
      const result = await productsCollection.find().toArray();
      res.send(result);
    });

    app.get("/category", async (req, res) => {
      const result = await categoryCollection.find().toArray();
      res.send(result);
    });

    // Carts Related api
    app.get("/carts", async (req, res) => {
      const email = req.query.email;
      const query = { userEmail: email };
      const result = await cartsCollection.find(query).toArray();
      res.send(result);
    });

    app.post("/carts", async (req, res) => {
      const cartsItems = req.body;
      const result = await cartsCollection.insertOne(cartsItems);
      res.send(result);
    });

    app.delete("/carts/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await cartsCollection.deleteOne(query);
      res.send(result);
    });
    
    // order Related api
    app.get("/orders", async (req, res) => {
      const email = req.query.email;
      const query = { userEmail: email };
      const result = await orderCollection.find(query).toArray();
      res.send(result);
    });

    app.get("/allOrders", async (req, res) => {
      const result = await orderCollection.find().toArray();
      res.send(result);
    });

    app.post("/bkash-checkout", async(req, res) => {
      try {
        const { amount, callbackURL, orderID, reference } = req.body
        const paymentDetails = {
          amount: amount || 10,                                                 // your product price
          callbackURL : callbackURL || 'http://127.0.0.1:3000/bkash-callback',  // your callback route
          orderID : orderID || 'Order_101',                                     // your orderID
          reference : reference || '1'                                          // your reference
        }
        const result =  await createPayment(bkashConfig, paymentDetails)
        res.send(result)
        console.log("BKASH-CHECKOUT__:",result);
      } catch (e) {
        console.log(e)
      }
    })
    
    app.get("/bkash-callback", async(req, res) => {
      try {
        const { status, paymentID } = req.query
        let result
        let response = {
          statusCode : '4000',
          statusMessage : 'Payment Failed'
        }
        if(status === 'success')  result =  await executePayment(bkashConfig, paymentID)
    
        if(result?.transactionStatus === 'Completed'){
          // payment success
          // insert result in your db
        }
        if(result) response = {
          statusCode : result?.statusCode,
          statusMessage : result?.statusMessage
        }
        // You may use here WebSocket, server-sent events, or other methods to notify your client
        res.send(response)
      } catch (e) {
        console.log(e)
      }
    })
    
    // Add this route under admin middleware
    app.post("/bkash-refund", async (req, res) => {
      try {
        const { paymentID, trxID, amount } = req.body
        const refundDetails = {
          paymentID,
          trxID,
          amount,
        }
        const result = await refundTransaction(bkashConfig, refundDetails)
        res.send(result)
      } catch (e) {
        console.log(e)
      }
    })
    
    app.get("/bkash-search", async (req, res) => {
      try {
        const { trxID } = req.query
        const result = await searchTransaction(bkashConfig, trxID)
        res.send(result)
      } catch (e) {
        console.log(e)
      }
    })
    
    app.get("/bkash-query", async (req, res) => {
      try {
        const { paymentID } = req.query
        const result = await queryPayment(bkashConfig, paymentID)
        res.send(result)
      } catch (e) {
        console.log(e)
      }
    })

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hello World! This is a base template for a Node.js server.");
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
