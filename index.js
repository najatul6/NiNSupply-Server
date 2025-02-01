require("dotenv").config();
const express = require("express");
const app = express();
const cors = require("cors");
const jwt = require("jsonwebtoken");
const { v4: uuidv4 } = require('uuid');
const globals = require('node-global-storage');

const port = process.env.PORT || 5000;
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const uri = process.env.MONGODB_URI;
app.use(express.json());

app.use(
  cors({ origin: ["https://nin-supply.vercel.app", "http://localhost:5173"] })
);

// bKash Authentication Middleware
app.use(async (req, res, next) => {
  try {
    const { data } = await axios.post(
      process.env.BKASH_BASE_URL,
      {
        app_key: process.env.BKASH_APP_KEY,
        app_secret: process.env.BKASH_APP_SECRET,
      },
      {
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          username: process.env.BKASH_USERNAME,
          password: process.env.BKASH_PASSWORD,
        },
      }
    );
    next();
  } catch (error) {
    return res.status(401).json({ error: error.message });
  }
});

const getBkashHeaders = async () => {
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    authorization: globals.get("id_token"),
    "x-app-key": process.env.bkash_api_key,
  };
};

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
    // await client.connect();

    // Create a database and collection
    const usersCollection = client.db("NiNSupply").collection("users");
    const productsCollection = client.db("NiNSupply").collection("products");
    const categoryCollection = client.db("NiNSupply").collection("category");
    const cartsCollection = client.db("NiNSupply").collection("carts");
    const orderCollection = client.db("NiNSupply").collection("all-orders");

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
    app.post("/orders", async (req, res) => {});

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

    // Payment Related api
    // Create Payment
    app.post("/api/bkash/payment", async (req, res) => {
      const { amount, userId } = req.body;
      globals.set("userId", userId);
      try {
        const { data } = await axios.post(
          process.env.bkash_create_payment_url,
          {
            mode: "0011",
            payerReference: " ",
            callbackURL: "http://localhost:5000/api/bkash/payment/callback",
            amount,
            currency: "BDT",
            intent: "sale",
            merchantInvoiceNumber: "Inv" + uuidv4().substring(0, 5),
          },
          {
            headers: await getBkashHeaders(),
          }
        );
        return res.status(200).json({ bkashURL: data.bkashURL });
      } catch (error) {
        return res.status(401).json({ error: error.message });
      }
    });

    // Payment Callback
    app.get("/api/bkash/payment/callback", async (req, res) => {
      const { paymentID, status } = req.query;
      if (status === "success") {
        try {
          const { data } = await axios.post(
            process.env.bkash_execute_payment_url,
            { paymentID },
            {
              headers: await getBkashHeaders(),
            }
          );
          if (data.statusCode === "0000") {
            return res.redirect(`http://localhost:5173/success`);
          } else {
            return res.redirect(
              `http://localhost:5173/error?message=${data.statusMessage}`
            );
          }
        } catch (error) {
          return res.redirect(
            `http://localhost:5173/error?message=${error.message}`
          );
        }
      }
    });

    // Send a ping to confirm a successful connection
    // await client.db("admin").command({ ping: 1 });
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
