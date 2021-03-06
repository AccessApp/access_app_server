const moment = require('moment')
const nanoid = require('nanoid')
const Visitor = require('../models/visitor.model')
const Place = require('../models/place.model')
const PlaceType = require('../models/place.type.model')
const Slot = require('../models/slot.model')
const Booking = require('../models/booking.model')
const slotTypes = require('../enums/slot.type.enum')

const DATE_FORMAT = 'DD.MM.YYYY'
const TIME_FORMAT = 'HH:mm'
const DATE_TIME_FORMAT = `${DATE_FORMAT} ${TIME_FORMAT}`

exports.generateUserId = (req, res) => {
  let id = nanoid.nanoid()

  new Visitor({
    _id: id,
    priorityId: 0,
    favourites: []
  }).save()
    .then(() => {
      return res.status(200).send({ id })
    })
    .catch(err => {
      return res.status(500).send({ message: 'Could not save user!' })
    })
}

exports.getBookings = async (req, res) => {
  if (!req.params.visitorId) {
    return res.status(400).send({ message: 'Invalid User ID' })
  }

  let skip = req.query.skip ? Number.parseInt(req.query.skip) : 0
  let load = req.query.load ? Number.parseInt(req.query.load) : 10

  let bookings = await Booking.find({ visitorId: req.params.visitorId }).skip(skip).limit(load).populate({
    path: 'slotId',
    populate: { path: 'placeId' }
  })
  let output = []

  bookings.sort((a, b) => a.slotId.starts - b.slotId.starts)

  for (const booking of bookings) {
    let o = output[moment(booking.slotId.starts).format(DATE_FORMAT)]
    if (o)
      o.push({
        name: booking.slotId.placeId.name,
        type: slotTypes.findById(booking.slotId.typeId).name,
        startTime: moment(booking.slotId.starts).format(TIME_FORMAT),
        endTime: moment(booking.slotId.ends).format(TIME_FORMAT),
        visitors: booking.friendsNumber,
        occupiedSlots: booking.slotId.occupiedSlots,
        maxSlots: booking.slotId.maxVisitors,
        slotId: booking.slotId._id,
        placeId: booking.slotId.placeId._id
      })
    else
      output[moment(booking.slotId.starts).format(DATE_FORMAT)] = [{
        name: booking.slotId.placeId.name,
        type: slotTypes.findById(booking.slotId.typeId).name,
        startTime: moment(booking.slotId.starts).format(TIME_FORMAT),
        endTime: moment(booking.slotId.ends).format(TIME_FORMAT),
        visitors: booking.friendsNumber,
        occupiedSlots: booking.slotId.occupiedSlots,
        maxSlots: booking.slotId.maxVisitors,
        slotId: booking.slotId._id,
        placeId: booking.slotId.placeId._id
      }]
  }

  return res.status(200).send({
    visits: { ...output }
  })
}

exports.getPlaces = async (req, res) => {
  let favourites = []
  if (req.params.visitorId) {
    let visitor = await Visitor.findById(req.params.visitorId)
    if (visitor) favourites = visitor.favourites
  }

  let skip = req.query.skip ? Number.parseInt(req.query.skip) : 0
  let load = req.query.load ? Number.parseInt(req.query.load) : 5

  let placeTypes = new Map()
  let types = await PlaceType.find()
  types.map(place => placeTypes.set(place._id, place.name))

  let search = {}

  if (req.query.typeId) search.placeTypeId = req.query.typeId
  if (req.query.name) search.name = new RegExp(`.*${req.query.name}.*`, 'i')
  if (req.query.approved !== undefined) search.approved = req.query.approved === 'true'
  if (req.query.own === 'true') search.creatorId = req.params.visitorId

  let places = await Place.find(search).sort({ name: 1 }).skip(skip).limit(load)

  let output = places.map(place => ({
    id: place._id,
    name: place.name,
    type: placeTypes.get(place.placeTypeId),
    description: place.description,
    www: place.url,
    address: place.address,
    location: place.coordinates,
    isFavourite: favourites.includes(place._id),
    approved: place.approved
  }))

  if (req.query.onlyFavourites === 'true') output = output.filter(place => place.isFavourite)

  return res.status(200).send({
    places: output
  })
}

exports.getPlaceSlots = async (req, res) => {
  if (!req.params.placeId) {
    return res.status(404).send({ message: 'Invalid Place ID' })
  }
  if (!req.params.visitorId) {
    return res.status(404).send({ message: 'Invalid Visitor ID' })
  }

  let skip = req.query.skip ? Number.parseInt(req.query.skip) : 0
  let load = req.query.load ? Number.parseInt(req.query.load) : 20

  let slots = await Slot.find({
    placeId: req.params.placeId,
    // starts: { $gte: moment().startOf('day').toDate() }
  }).sort({ starts: 1 }).skip(skip).limit(load)

  let slotIds = slots.map(slot => (slot.id))

  let bookings = await Booking.find({ slotId: { $in: slotIds } })

  let output = []

  slots.forEach(slot => {
    let o = output[moment(slot.starts).format(DATE_FORMAT)]
    let booking = bookings.find(booking => booking.slotId === slot._id && booking.visitorId === req.params.visitorId)
    if (o) o.push({
      id: slot.id,
      type: slotTypes.findById(slot.typeId).name,
      from: moment(slot.starts).format(TIME_FORMAT),
      to: moment(slot.ends).format(TIME_FORMAT),
      occupiedSlots: slot.occupiedSlots,
      maxSlots: slot.maxVisitors,
      isPlanned: !!booking,
      friends: booking && booking.friendsNumber ? booking.friendsNumber : 0
    })
    else
      output[moment(slot.starts).format(DATE_FORMAT)] = [{
        id: slot.id,
        type: slotTypes.findById(slot.typeId).name,
        from: moment(slot.starts).format(TIME_FORMAT),
        to: moment(slot.ends).format(TIME_FORMAT),
        occupiedSlots: slot.occupiedSlots,
        maxSlots: slot.maxVisitors,
        isPlanned: !!booking,
        friends: booking && booking.friendsNumber ? booking.friendsNumber : 0
      }]
  })

  return res.status(200).send({
    slots: { ...output }
  })
}

exports.changeFavourite = async (req, res) => {
  if (!req.params.visitorId)
    return res.status(400).send({ message: 'Invalid User ID' })

  if (!req.params.placeId)
    return res.status(400).send({ message: 'Invalid Place ID' })

  let visitor = await Visitor.findById(req.params.visitorId)

  if (!visitor)
    return res.status(400).send({ message: 'Invalid User ID' })

  if (visitor.favourites.includes(req.params.placeId)) {
    for (let i = 0; i < visitor.favourites.length; i++) {
      if (visitor.favourites[i] === req.params.placeId) {
        visitor.favourites.splice(i, 1)
        break
      }
    }
  } else visitor.favourites.push(req.params.placeId)

  await visitor.save()

  return res.status(204).send()
}

exports.visit = async (req, res) => {
  if (!req.params.visitorId || !req.body.slotId || !req.body.visitors) {
    return res.status(404).send({ message: 'Invalid data!' })
  }

  if (req.body.visitors > 7 || req.body.visitors < 1)
    return res.status(400).send({ message: 'Visitors must be between 1 and 7' })

  let slot = await Slot.findById(req.body.slotId)

  if (!slot) return res.status(404).send({ message: 'Slot not found' })

  let people = req.body.visitors

  let booking = await Booking.findOne({ slotId: req.body.slotId, visitorId: req.params.visitorId })

  if (booking) {
    people -= booking.friendsNumber
    if (people !== 0) {
      if (slot.occupiedSlots + people > slot.maxVisitors)
        return res.status(400).send({ message: 'Not enough place on this slot!' })

      booking.friendsNumber = req.body.visitors
      await booking.save()
    } else
      return res.status(204).send()

  } else {
    if (slot.occupiedSlots + people > slot.maxVisitors)
      return res.status(400).send({ message: 'Not enough place on this slot!' })

    let bookings = await Booking.find({ visitorId: req.params.visitorId }).populate({
      path: 'slotId',
      match: {
        $or:
          [
            {
              starts: // 10
                {
                  $gte: slot.starts, // 10
                  $lt: slot.ends // 11
                }
            },
            {
              ends: // 11
                {
                  $gt: slot.starts, // 10
                  $lte: slot.ends // 11
                }
            }
          ]
      },
      populate: { path: 'placeId' },
    })
    for (const booking of bookings) {
      if (booking !== null && booking.slotId) return res.status(400).send({
        message: `You already have a booking at ${booking.slotId.placeId.name} (${moment(booking.slotId.starts).format(TIME_FORMAT)} - ${moment(booking.slotId.ends).format(TIME_FORMAT)}) that overlaps with this booking!`
      })
    }

    new Booking({
      _id: nanoid.nanoid(),
      slotId: req.body.slotId,
      visitorId: req.params.visitorId,
      friendsNumber: people
    }).save()
  }

  slot.occupiedSlots += people
  await slot.save()

  return res.status(204).send()
}

exports.deleteVisit = async (req, res) => {
  if (!req.params.visitorId || !req.params.slotId) {
    return res.status(404).send({ message: 'Invalid data!' })
  }

  let found = await Booking.findOneAndDelete({ visitorId: req.params.visitorId, slotId: req.params.slotId })

  if (found) await Slot.findByIdAndUpdate(req.params.slotId,
    { $inc: { occupiedSlots: (found.friendsNumber * (-1)) } })

  return res.status(204).send()
}

exports.getPlaceTypes = async (req, res) => {
  let places = (await PlaceType.find()).map(place => ({ id: place._id, name: place.name }))
  return res.status(200).send({ placeTypes: places })
}

exports.addPlace = async (req, res) => {
  if (
    !req.params.userId ||
    !req.body.name ||
    !req.body.description) {
    return res.status(400).send({ message: 'Missing body parameter!' })
  }

  let id = nanoid.nanoid()

  let img
  if (req.body.image) {
    img = new Buffer.from(req.body.image, 'base64')
    if (!img) return res.status(400).send({ message: 'Failed to upload image!' })
  }

  let placeTypeId = 0
  if (req.body.placeTypeId) placeTypeId = req.body.typeId

  await new Place({
    _id: id,
    creatorId: req.params.userId,
    name: req.body.name,
    placeTypeId: placeTypeId,
    imageData: img,
    description: req.body.description,
    url: req.body.www,
    address: req.body.address,
    coordinates: req.body.location,
    approved: false
  }).save()

  return res.status(201).send()
}

exports.editPlace = async (req, res) => {
  if (
    !req.params.userId ||
    !req.params.placeId) {
    return res.status(400).send({ message: 'Missing parameter!' })
  }

  let place = await Place.findById(req.params.placeId)

  if (!place) return res.status(404).send({ message: 'Place not found' })

  if (req.params.userId !== place.creatorId) return res.status(401).send({ message: 'User not creator' })

  let img
  if (req.body.image) {
    img = new Buffer.from(req.body.image, 'base64')
    if (!img) return res.status(400).send({ message: 'Failed to upload image!' })
  }

  if (req.body.name) place.name = req.body.name
  if (req.body.description) place.description = req.body.description
  if (req.body.typeId) place.placeTypeId = req.body.typeId
  if (img) place.imageData = img
  if (req.body.www) place.url = req.body.www
  if (req.body.address) place.address = req.body.address
  if (req.body.location) place.coordinates = req.body.location

  await place.save()

  return res.status(200).send()
}

exports.getImage = async (req, res) => {
  if (!req.params.placeId) {
    return res.status(400).send({ message: 'Invalid place id' })
  }
  let place = await Place.findById(req.params.placeId)
  if (place) {
    res.contentType('image/png')
    res.status(200).send(place.imageData)
  }
}

const API_KEY = '0YYtJqHR65OgpxkPygHwMC557ykFw0gE'

exports.getCoordinates = async (req, res) => {
  if (
    !req.body.userId ||
    !req.body.address) {
    return res.status(400).send({ message: 'Missing body params' })
  }

  const url = `http://www.mapquestapi.com/geocoding/v1/address?key=${API_KEY}&thumbMaps=false&maxResults=1&location=${req.body.address}`

  await http.get(url, (resp) => {
    let data = ''

    resp.on('data', (chunk) => {
      data += chunk
    })

    resp.on('end', () => {
      if (JSON.parse(data).results[0].locations.length > 0) {
        let loc = JSON.parse(data).results[0].locations[0].latLng
        return res.status(200).send({ coordinates: `${loc.lat},${loc.lng}` })
      }
      return res.status(404).send({ message: 'Location not found!' })
    })

  }).on('error', (err) => {
    return res.status(500).send({ message: 'Can\'t connect..' })
  })
}

exports.addSlot = async (req, res) => {
  if (
    !req.body.type ||
    !req.params.placeId ||
    !req.params.userId ||
    !req.body.from ||
    !req.body.to ||
    !req.body.maxSlots) {
    return res.status(400).send({ message: 'Missing body parameter!' })
  }

  let place = await Place.findById(req.params.placeId)
  if (!place) return res.status(404).send({ message: 'Place not found' })
  if (place.creatorId !== req.params.userId) return res.status(401).send({ message: 'User not creator' })

  new Slot({
    _id: nanoid.nanoid(),
    placeId: req.params.placeId,
    typeId: slotTypes.findByName(req.body.type).id,
    starts: moment(`${req.body.from}`, DATE_TIME_FORMAT).toDate(),
    ends: moment(`${req.body.to}`, DATE_TIME_FORMAT).toDate(),
    occupiedSlots: 0,
    maxVisitors: req.body.maxSlots
  }).save()

  return res.status(201).send()
}

exports.deleteSlot = async (req, res) => {
  if (!req.params.slotId ||
    !req.params.userId) {
    return res.status(400).send({ message: 'Missing body parameter!' })
  }

  let slot = await Slot.findOne({ _id: req.params.slotId }).populate({
    path: 'placeId'
  })

  if (!slot) return res.status(404).send({message: 'Slot not found'})

  if (slot.placeId.creatorId !== req.params.userId)
    return res.status(401).send({message: 'User is not the creator'})

  await Booking.deleteMany({slotId: req.params.slotId})
  await slot.delete()

  return res.status(201).send()
}

exports.approve = async (req, res) => {
  if (!req.params.placeId ||
    !req.params.approvedStatus)
    return res.status(400).send({ message: 'Missing parameter!' })

  await Place.updateOne({ _id: req.params.placeId }, { $set: { approved: req.params.approvedStatus } })

  return res.status(201).send()
}

exports.deletePlace = async (req, res) => {
  if (!req.params.placeId)
    return res.status(400).send({ message: 'Missing parameter!' })

  await Place.deleteOne({ _id: req.params.placeId })

  return res.status(201).send()
}

exports.isAuthorised = async (req, res) => {
  return res.status(201).send()
}